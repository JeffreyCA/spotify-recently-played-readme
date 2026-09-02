import { memoOnlyGet, memoOnlySet } from './cache';
import { logError } from './log';
import { base64ToBytes, bytesToBase64Url, utf8 } from './util/base64';
import { FIREBASE_BUDGET_MS, GOOGLE_TOKEN_BUDGET_MS } from './util/deadline';

/**
 * Firebase Realtime Database over its REST API.
 *
 * `firebase-admin` is a Node SDK - Node crypto, gRPC, a long-lived connection -
 * and does not run on Workers. This talks to the REST API directly and mints
 * its own Google access token by signing a service-account JWT with WebCrypto,
 * rather than pulling in one of the two abandoned npm packages (newest
 * published in 2023) that would each sit in the credential path for one
 * function.
 *
 * It also removes the cold-start problem the old README documented at length:
 * the Admin SDK's first call could take seconds and blow Camo's timeout, which
 * is what the `/api/warmup` cron endpoint existed to paper over. A REST call
 * has no connection to establish, and the minted token is cached per isolate.
 */

export interface FirebaseEnv {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY_B64?: string;
  FIREBASE_DATABASE_URL?: string;
}

export class FirebaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseError';
  }
}

/**
 * Spotify user IDs that this service will touch.
 *
 * This is a security boundary, not a formatting rule. With the Admin SDK the
 * ID was a key; over REST it is a path segment in `/{key}.json`, so `/`, `..`
 * and anything that terminates the path early are live concerns.
 *
 * Production contains legacy Spotify IDs with Unicode letters and punctuation
 * such as `+`, `*`, `?`, `!` and `;`, so this cannot be an ASCII allowlist.
 * Reject `/`, `\`, `%`, `$`, `#`, `[`, `]`, whitespace, controls and malformed
 * UTF-16, then map the rest onto a Realtime Database key with `databaseKey`
 * below.
 *
 * `.` is admitted because Spotify issues legacy IDs like `first.last`, and an
 * ID can never be changed, so those accounts would otherwise be locked out
 * for good. It is safe only because `databaseKey` escapes it before the ID
 * touches the path - see the note there. An ID made of nothing but dots is
 * still refused: Spotify has never issued one, and it costs nothing.
 */
/** Keep the build-free configurator copy in public/app.js in sync. */
const USER_ID_MAX_LENGTH = 64;
const USER_ID_UNSAFE_RE = /[$#\[\]\/\\%\s\u0000-\u001F\u007F\uD800-\uDFFF]/u;
const USER_ID_ONLY_DOTS_RE = /^\.+$/;

export function isValidUserId(value: string): boolean {
  const length = [...value].length;
  return (
    length > 0 &&
    length <= USER_ID_MAX_LENGTH &&
    !USER_ID_UNSAFE_RE.test(value) &&
    !USER_ID_ONLY_DOTS_RE.test(value)
  );
}

/**
 * The Realtime Database key that holds a user's node.
 *
 * Keys cannot contain `.`, `$`, `#`, `[`, `]` or `/`, so those are written as
 * `%XX`. Two properties matter more than the exact scheme:
 *
 * - It is the identity for every ID stored before dots were admitted, so no
 *   existing node moves. Only the six forbidden characters are touched, and
 *   `isValidUserId` already refuses five of them - `.` is the only one that
 *   reaches here today. The others are kept so this stays a complete map of
 *   the Realtime Database rule rather than an assumption about the validator.
 * - It is injective. `%` is rejected in raw IDs by `isValidUserId`, so a `%`
 *   in a key can only have come from here, and two IDs can never share a node.
 *
 * This is also what makes admitting `.` safe: the key never contains one, so
 * `..` reaches the REST path as `%252E%252E` rather than as a segment that
 * resolves to the database root.
 */
const KEY_ESCAPE_RE = /[.$#\[\]\/]/g;

export function databaseKey(userId: string): string {
  return userId.replace(
    KEY_ESCAPE_RE,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/**
 * Validate first, encode second. Encoding alone is not the boundary: it would
 * turn `../foo` into something that still resolves upward on some server, and
 * it cannot tell us the value was never plausible to begin with.
 *
 * Case is preserved. Realtime Database keys are case-sensitive, the old app
 * stored whatever `/v1/me` returned, and lookups use the raw `?user=` value -
 * so lowercasing here would fail to find existing nodes.
 */
export function pathSegment(userId: string): string {
  if (!isValidUserId(userId)) {
    throw new FirebaseError('Invalid Spotify user ID');
  }
  return encodeURIComponent(databaseKey(userId));
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const PEM_HEADER = /-----BEGIN [A-Z ]+-----/;
const PEM_FOOTER = /-----END [A-Z ]+-----/;

/**
 * The env var holds base64 of a PEM. Some deployments store it with literal
 * backslash-n sequences rather than real newlines - the Vercel app had an
 * explicit fixup for that, so it is reproduced rather than assumed away.
 */
function privateKeyDer(privateKeyB64: string): Uint8Array {
  let pem = new TextDecoder().decode(base64ToBytes(privateKeyB64.trim()));
  if (pem.includes('\\n')) pem = pem.replace(/\\n/g, '\n');

  if (!PEM_HEADER.test(pem)) {
    throw new FirebaseError('FIREBASE_PRIVATE_KEY_B64 does not decode to a PEM key');
  }

  const body = pem.replace(PEM_HEADER, '').replace(PEM_FOOTER, '').replace(/\s+/g, '');
  return base64ToBytes(body);
}

const signingKeys = new Map<string, Promise<CryptoKey>>();

function importSigningKey(privateKeyB64: string): Promise<CryptoKey> {
  const cached = signingKeys.get(privateKeyB64);
  if (cached) return cached;

  const promise = crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer(privateKeyB64) as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  signingKeys.set(privateKeyB64, promise);
  return promise;
}

async function serviceAccountJwt(env: FirebaseEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: SCOPES,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const body = `${bytesToBase64Url(utf8(JSON.stringify(header)))}.${bytesToBase64Url(
    utf8(JSON.stringify(claims)),
  )}`;

  const key = await importSigningKey(env.FIREBASE_PRIVATE_KEY_B64!);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    utf8(body) as BufferSource,
  );
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Google access tokens last an hour. Signing an RS256 JWT and exchanging it on
 * every card render would dominate the latency budget, so the result is held
 * in the isolate - never the Cache API, which persists a credential to disk.
 */
async function googleAccessToken(env: FirebaseEnv, timeoutMs: number): Promise<string> {
  const key = `google:${env.FIREBASE_CLIENT_EMAIL}`;
  const cached = memoOnlyGet(key);
  if (cached) return cached;

  const assertion = await serviceAccountJwt(env);

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FirebaseError('Could not reach Google to authenticate');
  }

  if (!response.ok) {
    // `error_description` is the difference between "clock skew" and "wrong
    // key", and is the whole reason this is logged rather than just thrown.
    logError('firebase', `firebase: Google token exchange failed (HTTP ${response.status})`, {
      op: 'token',
      status: response.status,
      detail: await safeText(response),
    });
    throw new FirebaseError('Firebase authentication failed');
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new FirebaseError('Firebase authentication returned no token');

  const ttl = Math.max(60, (body.expires_in ?? 3600) - 60);
  memoOnlySet(key, body.access_token, ttl);
  return body.access_token;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** The stored node. Fields are optional because old nodes predate the new one. */
export interface TokenNode {
  access_token?: string;
  refresh_token?: string;
  refresh_token_enc?: string;
  schema_v?: number;
}

export function isConfigured(env: FirebaseEnv): boolean {
  return Boolean(
    env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY_B64 &&
      env.FIREBASE_DATABASE_URL,
  );
}

async function request(
  env: FirebaseEnv,
  userId: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const token = await googleAccessToken(env, Math.min(timeoutMs, GOOGLE_TOKEN_BUDGET_MS));
  const base = env.FIREBASE_DATABASE_URL!.replace(/\/+$/, '');
  const url = `${base}/${pathSegment(userId)}.json`;

  try {
    return await fetch(url, {
      ...init,
      headers: {
        // Bearer rather than `?access_token=`: a credential in a URL ends up in
        // request logs on both sides.
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new FirebaseError(aborted ? 'Firebase timed out' : 'Could not reach Firebase');
  }
}

/**
 * One request for the whole node. The Vercel app read `access_token` and
 * `refresh_token` as two separate round trips, which is two chances to eat the
 * budget for data that arrives together anyway.
 */
export async function readTokenNode(
  env: FirebaseEnv,
  userId: string,
  timeoutMs: number = FIREBASE_BUDGET_MS,
): Promise<TokenNode | null> {
  const response = await request(env, userId, { method: 'GET' }, timeoutMs);

  if (response.status === 404) return null;
  if (!response.ok) {
    logError('firebase', `firebase: read failed for ${userId} (HTTP ${response.status})`, {
      op: 'read',
      user: userId,
      status: response.status,
      detail: await safeText(response),
    });
    throw new FirebaseError('Could not read from Firebase');
  }

  const body = (await response.json()) as TokenNode | null;
  return body && typeof body === 'object' ? body : null;
}

/** PATCH so unrelated fields on the node are left alone. */
export async function writeTokenNode(
  env: FirebaseEnv,
  userId: string,
  fields: TokenNode,
  timeoutMs: number = FIREBASE_BUDGET_MS,
): Promise<void> {
  const response = await request(
    env,
    userId,
    { method: 'PATCH', body: JSON.stringify(fields) },
    timeoutMs,
  );

  if (!response.ok) {
    logError('firebase', `firebase: write failed for ${userId} (HTTP ${response.status})`, {
      op: 'write',
      user: userId,
      status: response.status,
      detail: await safeText(response),
    });
    throw new FirebaseError('Could not write to Firebase');
  }
}

export async function deleteTokenNode(
  env: FirebaseEnv,
  userId: string,
  timeoutMs: number = FIREBASE_BUDGET_MS,
): Promise<void> {
  const response = await request(env, userId, { method: 'DELETE' }, timeoutMs);

  if (!response.ok) {
    logError('firebase', `firebase: delete failed for ${userId} (HTTP ${response.status})`, {
      op: 'delete',
      user: userId,
      status: response.status,
      detail: await safeText(response),
    });
    throw new FirebaseError('Could not delete from Firebase');
  }
}
