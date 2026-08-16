/**
 * Base64 helpers shared by the Firebase service-account JWT, the OAuth state
 * signature, the token encryption and the cover-art inlining.
 *
 * `btoa`/`atob` are the only primitives Workers give us, and they speak
 * latin-1 strings rather than bytes, so everything here is about crossing that
 * boundary without corrupting anything.
 */

/**
 * btoa() on a large spread array blows the stack, so this chunks. Cover art
 * runs to hundreds of kilobytes and will hit that limit; the token paths never
 * will, but they share the function rather than keeping two.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Unpadded base64url, as JWTs and the stored token format both require. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Accepts either alphabet, padded or not. Deliberately liberal on input and
 * strict on output: a value that round-trips through a config field or a URL
 * can easily come back with `+` swapped for `-`, and failing on that would
 * present as "your token is corrupt" rather than "your encoding differs".
 */
export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
