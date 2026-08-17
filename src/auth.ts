import { memoOnlyDelete, memoOnlyGet, memoOnlySet, type WaitUntilCtx } from './cache';
import { decryptToken, encryptToken } from './crypto';
import type { Env } from './env';
import { readTokenNode, writeTokenNode, type TokenNode } from './firebase';
import { errFields, logInfo, logWarn } from './log';
import { bytesToBase64 } from './util/base64';
import { SPOTIFY_BUDGET_MS } from './util/deadline';

const ACCOUNTS_ROOT = 'https://accounts.spotify.com';

/**
 * Exactly the scopes the shipped features need, and no more.
 *
 * `user-read-recently-played` is what every existing user already granted to
 * the Vercel app. `user-read-currently-playing` is new, so every one of those
 * users gets a **401 "Permissions missing"** for the now-playing row until they
 * reconnect - which the card handles by dropping that section, never by
 * failing. (401, not the 403 the API schema documents. See spotify.ts.)
 *
 * `user-top-read` is deliberately absent. The feature it would serve is not
 * built, and asking for a scope ahead of the feature is how consent screens
 * become alarming.
 */
export const SCOPES = ['user-read-recently-played', 'user-read-currently-playing'];

export class SpotifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

/**
 * The user must go through the authorize flow again: no stored tokens, or a
 * refresh token Spotify no longer accepts. Distinct from a transient failure
 * because the card's advice is different and there is no point retrying.
 */
export class ReauthorizeError extends Error {
  constructor(message = 'Spotify authorization needed') {
    super(message);
    this.name = 'ReauthorizeError';
  }
}

export function redirectUri(env: Env): string {
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/callback`;
}

export function authorizeUrl(env: Env, state: string, showDialog: boolean): string {
  const url = new URL('/authorize', ACCOUNTS_ROOT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.SPOTIFY_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri(env));
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  // Off for the disconnect bounce, which only needs to learn who is asking and
  // should not look like a second grant.
  url.searchParams.set('show_dialog', showDialog ? 'true' : 'false');
  return url.toString();
}

function basicAuth(env: Env): string {
  const raw = `${env.SPOTIFY_CLIENT_ID ?? ''}:${env.SPOTIFY_CLIENT_SECRET ?? ''}`;
  return `Basic ${bytesToBase64(new TextEncoder().encode(raw))}`;
}

interface TokenResponse {
  access_token: string;
  /** Absent on a refresh unless Spotify chose to rotate it. */
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(
  env: Env,
  body: Record<string, string>,
  timeoutMs: number,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${ACCOUNTS_ROOT}/api/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(env),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SpotifyAuthError('Could not reach Spotify');
  }

  const text = await response.text();
  let parsed: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new SpotifyAuthError(`Spotify returned a malformed token response (HTTP ${response.status})`);
  }

  if (!response.ok || !parsed.access_token) {
    // `invalid_grant` means the refresh token is dead - revoked, expired, or
    // issued by a different client. Retrying cannot help; only the user can.
    if (parsed.error === 'invalid_grant') throw new ReauthorizeError();
    throw new SpotifyAuthError(parsed.error ?? `Spotify token request failed (HTTP ${response.status})`);
  }

  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expires_in: parsed.expires_in,
  };
}

export function exchangeCode(
  env: Env,
  code: string,
  timeoutMs: number = SPOTIFY_BUDGET_MS,
): Promise<TokenResponse> {
  return tokenRequest(
    env,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) },
    timeoutMs,
  );
}

export function refreshTokens(
  env: Env,
  refreshToken: string,
  timeoutMs: number = SPOTIFY_BUDGET_MS,
): Promise<TokenResponse> {
  return tokenRequest(
    env,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    timeoutMs,
  );
}

const accessTokenKey = (userId: string) => `sptoken:${userId}`;

/**
 * Writes the node.
 *
 * The encrypted field is what this Worker reads. The two plaintext fields are
 * written because the Vercel app is still live against the same database and
 * hard-guards on both being present - blanking either one breaks every user
 * who has not migrated. They come out when it stops reading Firebase; see
 * AGENTS.md.
 */
async function saveTokens(
  env: Env,
  userId: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const fields: TokenNode = {
    access_token: accessToken,
    refresh_token: refreshToken,
    schema_v: 1,
  };

  if (env.TOKEN_ENC_KEY) {
    fields.refresh_token_enc = await encryptToken(refreshToken, userId, env.TOKEN_ENC_KEY);
  }

  await writeTokenNode(env, userId, fields);
}

/** Used by the callback, which must not report success before the write lands. */
export { saveTokens };

/**
 * The refresh token for a user, preferring the encrypted copy.
 *
 * A plaintext hit schedules the encrypted copy to be written back, so accounts
 * migrate as their cards render. Anyone whose card never renders simply stays
 * on plaintext, which is the same place they are today.
 */
async function readRefreshToken(
  env: Env,
  userId: string,
  ctx?: WaitUntilCtx,
): Promise<string | null> {
  const node = await readTokenNode(env, userId);
  if (!node) return null;

  if (node.refresh_token_enc && env.TOKEN_ENC_KEY) {
    const decrypted = await decryptToken(node.refresh_token_enc, userId, env.TOKEN_ENC_KEY);
    // A null here means a wrong key, a tampered value, or a blob belonging to
    // someone else. Fall through to plaintext rather than locking the user out.
    if (decrypted) return decrypted;
    logWarn('auth', { step: 'decrypt_failed', user: userId });
  }

  const plaintext = node.refresh_token;
  if (!plaintext) return null;

  if (env.TOKEN_ENC_KEY && !node.refresh_token_enc) {
    const migrate = (async () => {
      try {
        const enc = await encryptToken(plaintext, userId, env.TOKEN_ENC_KEY!);
        await writeTokenNode(env, userId, { refresh_token_enc: enc, schema_v: 1 });
        // Once per account, ever. Counting them is what says whether the
        // plaintext fields can be dropped yet - see AGENTS.md.
        logInfo('auth', { step: 'encrypted', user: userId });
      } catch (err) {
        logWarn('auth', { step: 'encrypt_failed', user: userId, ...errFields(err) });
      }
    })();
    if (ctx) ctx.waitUntil(migrate);
  }

  return plaintext;
}

/**
 * An access token for `userId`, minting one when the isolate does not hold a
 * live one.
 *
 * The stored `access_token` is never read. The Vercel app validated it with a
 * `GET /v1/me` before every render, which spends a round trip to avoid a round
 * trip; and the stored copy is only rewritten when we refresh, so after an hour
 * it is stale anyway. Refreshing outright is one call either way and needs no
 * branch.
 */
export async function getAccessToken(
  env: Env,
  userId: string,
  ctx?: WaitUntilCtx,
): Promise<string> {
  const cached = memoOnlyGet(accessTokenKey(userId));
  if (cached) return cached;

  const refreshToken = await readRefreshToken(env, userId, ctx);
  if (!refreshToken) throw new ReauthorizeError();

  const tokens = await refreshTokens(env, refreshToken);
  memoOnlySet(accessTokenKey(userId), tokens.access_token, Math.max(60, (tokens.expires_in ?? 3600) - 60));

  const rotated = Boolean(tokens.refresh_token && tokens.refresh_token !== refreshToken);
  // Only on a memo miss, so this counts the cold path rather than every render.
  // `rotated` is the one worth watching: if the write-back below fails after a
  // rotation, the stored token may already be dead.
  logInfo('auth', { step: 'refreshed', user: userId, rotated });

  // Spotify sometimes rotates the refresh token. When it does the old one may
  // stop working, so the new one has to be persisted; when it does not, the
  // existing one is still current.
  const write = saveTokens(env, userId, tokens.access_token, tokens.refresh_token ?? refreshToken).catch(
    (err: unknown) => {
      logWarn('auth', { step: 'writeback_failed', user: userId, rotated, ...errFields(err) });
    },
  );
  // Deliberately not awaited on the render path: `waitUntil` is a runtime
  // guarantee on Workers, so the write completes without the reader paying for
  // it. The callback awaits its write instead, because there the write *is*
  // what the response is reporting.
  if (ctx) ctx.waitUntil(write);

  return tokens.access_token;
}

/** Drops a cached access token, so the next render mints a fresh one. */
export function forgetAccessToken(userId: string): void {
  memoOnlyDelete(accessTokenKey(userId));
}
