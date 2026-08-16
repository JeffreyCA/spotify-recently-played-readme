import { memoOnlyGet, memoOnlySet } from './cache';
import { base64ToBytes, bytesToBase64Url, utf8 } from './util/base64';
import { FIREBASE_BUDGET_MS, GOOGLE_TOKEN_BUDGET_MS } from './util/deadline';

/**
 * Firebase Realtime Database over its REST API.
 *
 * `firebase-admin` is a Node SDK - Node crypto, gRPC, a long-lived connection -
 * and does not run on Workers. This talks to the REST API directly and mints
 * its own Google access token by signing a service-account JWT with WebCrypto.
 *
 * That is about eighty lines, against two abandoned npm packages (the newest
 * published in 2023) that would each be pulled in for one function and sit in
 * the credential path. Worth owning.
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
 * ID was a key; over REST it is a path segment in `/{user}.json`, so `/`, `..`
 * and anything that terminates the path early are live concerns.
 *
 * Realtime Database keys can never contain `.`, `$`, `#`, `[`, `]` or `/`, so
 * the old app would have thrown on such an ID and nobody outside that set can
 * already be stored. This allowlist is stricter still - it also rejects `%`,
 * `?`, whitespace, control characters and unexpected Unicode, all of which
 * matter for a path segment and none of which that denylist covers. The
 * residual risk is rejecting a real legacy ID containing something exotic like
 * `~`; nobody has reported one, and widening the class is a one-line change.
 */
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidUserId(value: string): boolean {
  return USER_ID_RE.test(value);
}

/**
 * Validate first, encode second. Encoding alone is not the boundary: it would
 * happily turn `../foo` into something that still resolves upward on some
 * server, and it cannot tell us the value was never plausible to begin with.
 *
 * Case is preserved. Realtime Database keys are case-sensitive, the old app
 * stored whatever `/v1/me` returned, and lookups use the raw `?user=` value -
 * so lowercasing here would fail to find existing nodes.
 */
function pathSegment(userId: string): string {
  if (!isValidUserId(userId)) {
    throw new FirebaseError('Invalid Spotify user ID');
  }
  return encodeURIComponent(userId);
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
    // The body carries `error_description`, which is the difference between
    // "clock skew" and "wrong key" and is worth having in a tail.
    console.error('[firebase] token exchange failed', response.status, await safeText(response));
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
    console.error('[firebase] read failed', response.status, await safeText(response));
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
    console.error('[firebase] write failed', response.status, await safeText(response));
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
    console.error('[firebase] delete failed', response.status, await safeText(response));
    throw new FirebaseError('Could not delete from Firebase');
  }
}
