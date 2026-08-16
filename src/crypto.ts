import { base64ToBytes, base64UrlToBytes, bytesToBase64Url, fromUtf8, utf8 } from './util/base64';

/**
 * Refresh-token encryption and OAuth state signing.
 *
 * Stored format: `v1:<base64url iv>:<base64url ciphertext+tag>`, AES-256-GCM,
 * with the Spotify user ID as `additionalData` so a value copied to another
 * user's node fails to decrypt instead of quietly authenticating as them.
 *
 * The `v1:` prefix costs nothing and leaves room to rotate later; no rotation
 * machinery is built behind it, because there is one key and this is a hobby
 * service. Adding a `v2` later means adding a branch here, not redesigning.
 */

const FORMAT_PREFIX = 'v1';
const IV_BYTES = 12;

/** Cached per key material, since importKey is not free and this runs per render. */
const keyCache = new Map<string, Promise<CryptoKey>>();

function importAesKey(keyB64: string): Promise<CryptoKey> {
  const cached = keyCache.get(keyB64);
  if (cached) return cached;

  const promise = (async () => {
    const raw = base64ToBytes(keyB64.trim());
    if (raw.length !== 32) {
      throw new Error('TOKEN_ENC_KEY must decode to exactly 32 bytes');
    }
    return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  })();

  keyCache.set(keyB64, promise);
  return promise;
}

/**
 * `iv` is only ever passed by tests, so the encrypt path can be asserted
 * against a known output. Production callers must let it default.
 */
export async function encryptToken(
  plaintext: string,
  userId: string,
  keyB64: string,
  iv: Uint8Array = crypto.getRandomValues(new Uint8Array(IV_BYTES)),
): Promise<string> {
  const key = await importAesKey(keyB64);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8(userId) as BufferSource },
    key,
    utf8(plaintext) as BufferSource,
  );
  return `${FORMAT_PREFIX}:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(sealed))}`;
}

/**
 * Returns null rather than throwing on anything malformed, wrong-keyed or
 * bound to a different user. Callers treat that as "no encrypted token" and
 * fall back to the legacy plaintext field, so a decryption problem degrades
 * to the old behaviour instead of locking someone out.
 */
export async function decryptToken(
  value: string,
  userId: string,
  keyB64: string,
): Promise<string | null> {
  const parts = value.split(':');
  if (parts.length !== 3 || parts[0] !== FORMAT_PREFIX) return null;

  try {
    const key = await importAesKey(keyB64);
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(parts[1]!) as BufferSource,
        additionalData: utf8(userId) as BufferSource,
      },
      key,
      base64UrlToBytes(parts[2]!) as BufferSource,
    );
    return fromUtf8(new Uint8Array(plain));
  } catch {
    return null;
  }
}

const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function importHmacKey(secret: string): Promise<CryptoKey> {
  const cached = hmacKeyCache.get(secret);
  if (cached) return cached;

  const promise = crypto.subtle.importKey(
    'raw',
    utf8(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  hmacKeyCache.set(secret, promise);
  return promise;
}

/**
 * Compares two strings in time independent of where they first differ.
 *
 * Overkill for a state parameter that also has to match a cookie, but it is
 * three lines and it means the next person to compare a secret here has a
 * correct function to reach for rather than `===`.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StatePayload {
  /** Random per-request value, also set as a cookie for the double submit. */
  nonce: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** `connect` grants and stores tokens; `disconnect` deletes the node. */
  intent: 'connect' | 'disconnect';
}

/**
 * `<base64url(json)>.<base64url(hmac)>`.
 *
 * Signing the state rather than storing a nonce server-side keeps the Worker
 * stateless: no KV, no D1, nothing to provision or clean up.
 */
export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = bytesToBase64Url(utf8(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, utf8(body) as BufferSource);
  return `${body}.${bytesToBase64Url(new Uint8Array(mac))}`;
}

/** Null when the signature fails, the payload is malformed, or it has expired. */
export async function verifyState(
  token: string,
  secret: string,
  maxAgeMs: number,
  now: number = Date.now(),
): Promise<StatePayload | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const key = await importHmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, utf8(body) as BufferSource);
  if (!timingSafeEqual(bytesToBase64Url(new Uint8Array(mac)), provided)) return null;

  try {
    const payload = JSON.parse(fromUtf8(base64UrlToBytes(body))) as StatePayload;
    if (typeof payload?.nonce !== 'string' || typeof payload?.iat !== 'number') return null;
    if (payload.intent !== 'connect' && payload.intent !== 'disconnect') return null;
    // Reject a future `iat` too: a signed state with a far-off timestamp would
    // otherwise be valid forever, and only our own clock can produce one.
    if (payload.iat > now + 60_000) return null;
    if (now - payload.iat > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}
