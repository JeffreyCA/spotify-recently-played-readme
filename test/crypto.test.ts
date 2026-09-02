import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, randomNonce, signState, verifyState } from '../src/crypto';
import { databaseKey, isValidUserId, pathSegment } from '../src/firebase';

/**
 * The two crypto properties worth pinning, and nothing else.
 *
 * Stored tokens are `v1:<base64url iv>:<base64url ciphertext+tag>`,
 * AES-256-GCM, with the Spotify user ID as `additionalData`.
 */

/** 32 bytes, as TOKEN_ENC_KEY must be. */
const KEY = btoa('0123456789abcdef0123456789abcdef');
const SECRET = 'test-state-secret';

describe('token encryption', () => {
  it('round-trips a refresh token', async () => {
    const token = 'AQCd-fake-refresh-token_1234567890';
    const stored = await encryptToken(token, 'jeffreyca16', KEY);

    expect(stored).not.toContain(token);
    expect(await decryptToken(stored, 'jeffreyca16', KEY)).toBe(token);
  });

  it('refuses anything it cannot verify, rather than throwing', async () => {
    // The user binding is what stops a blob copied to another node
    // authenticating as its new owner. Returning null rather than throwing is
    // what lets a key problem fall back to the legacy plaintext field instead
    // of locking someone out.
    const stored = await encryptToken('secret-token', 'jeffreyca16', KEY);
    const otherKey = btoa('fedcba9876543210fedcba9876543210');

    expect(await decryptToken(stored, 'someone-else', KEY)).toBeNull();
    expect(await decryptToken(stored, 'jeffreyca16', otherKey)).toBeNull();
    expect(await decryptToken('not-this-format', 'jeffreyca16', KEY)).toBeNull();
  });
});

describe('OAuth state', () => {
  it('round-trips, and rejects tampering, a wrong secret, and expiry', async () => {
    const now = Date.now();
    const nonce = randomNonce();

    const token = await signState({ nonce, iat: now, intent: 'connect' }, SECRET);
    expect((await verifyState(token, SECRET, 600_000, now))?.nonce).toBe(nonce);

    const [body, mac] = token.split('.');
    expect(await verifyState(`${body}.${mac!.slice(0, -2)}xy`, SECRET, 600_000, now)).toBeNull();
    expect(await verifyState(token, 'a-different-secret', 600_000, now)).toBeNull();

    const old = await signState({ nonce, iat: now - 900_000, intent: 'connect' }, SECRET);
    expect(await verifyState(old, SECRET, 600_000, now)).toBeNull();

    // A future `iat` would otherwise be valid forever, and only our own clock
    // can produce one.
    const future = await signState({ nonce, iat: now + 3_600_000, intent: 'connect' }, SECRET);
    expect(await verifyState(future, SECRET, 600_000, now)).toBeNull();
  });
});

describe('user IDs', () => {
  it('accepts legacy IDs while rejecting anything unsafe for its path segment', () => {
    // This guards a delete. Dots are escaped by databaseKey before they reach
    // the path, but an ID made only of dots is refused anyway.
    for (const bad of [
      '..',
      '.',
      '...',
      '',
      '/',
      'a/b',
      '%2f',
      'a%2eb',
      'a%2fb',
      '#',
      '$',
      '[x]',
      'a\\b',
      'a b',
      'a\tb',
      '\0',
      '\u007f',
      '\ud800',
      'x'.repeat(65),
    ]) {
      expect(isValidUserId(bad), bad).toBe(false);
    }

    for (const valid of [
      'ordinary_user-9',
      'first.last',
      'a..b',
      'legacy+user',
      'legacy*user',
      'legacy?user',
      'legacy!user',
      'legacy;user',
      'café_user',
      'ユーザー',
    ]) {
      expect(isValidUserId(valid), valid).toBe(true);
    }
  });

  it('maps IDs onto Realtime Database keys without moving existing nodes', () => {
    // Identity for everything that was valid before dots were admitted, so no
    // stored node changes address.
    for (const id of ['jeffreyca16', 'legacy+user', 'legacy?user!', 'café_user', 'ユーザー']) {
      expect(databaseKey(id), id).toBe(id);
    }

    expect(databaseKey('first.last')).toBe('first%2Elast');
    expect(databaseKey('a..b')).toBe('a%2E%2Eb');

    // The whole point: a dot never reaches the path, so `..` cannot resolve
    // upward. `%` is refused in raw IDs, so no raw ID can forge this form.
    for (const id of ['a..b', '..a', 'a..', 'first.last']) {
      const segment = pathSegment(id);
      expect(segment, id).not.toContain('.');
      expect(segment, id).not.toContain('/');
      expect(decodeURIComponent(segment), id).toBe(databaseKey(id));
    }

    expect(() => pathSegment('..')).toThrow('Invalid Spotify user ID');
    expect(() => pathSegment('a/b')).toThrow('Invalid Spotify user ID');
  });
});
