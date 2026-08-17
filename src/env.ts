import type { FirebaseEnv } from './firebase';

/**
 * Configuration reaching the Worker.
 *
 * Only four of these are credentials. The split is documented in README.md and
 * AGENTS.md: a secret cannot be read back once set, so over-classifying an
 * identifier makes a typo in it undebuggable.
 */
export interface Env extends FirebaseEnv {
  ASSETS: Fetcher;

  /**
   * Public. Declared in `wrangler.jsonc` - it appears in the authorize URL
   * every user's browser follows, and the Vercel app called it
   * `NEXT_PUBLIC_CLIENT_ID`.
   */
  SPOTIFY_CLIENT_ID?: string;

  /** Secret: `npx wrangler secret put SPOTIFY_CLIENT_SECRET` */
  SPOTIFY_CLIENT_SECRET?: string;
  /** Secret. Signs the OAuth `state` parameter. */
  STATE_SECRET?: string;
  /**
   * Secret. Base64 of 32 bytes; encrypts stored refresh tokens.
   *
   * The one value here worth backing up: once the legacy plaintext
   * `refresh_token` field is dropped, losing this key means every user has to
   * authorize again.
   */
  TOKEN_ENC_KEY?: string;

  /**
   * Public. Origin the OAuth redirect URI is built from.
   *
   * Not derived from the Host header: that is caller-controlled, and Spotify
   * matches redirect URIs exactly, so a spoofed value would send the code
   * somewhere else.
   */
  PUBLIC_BASE_URL?: string;

  UPSTREAM_CACHE_SECONDS?: string;
  NOW_PLAYING_CACHE_SECONDS?: string;
  ART_CACHE_SECONDS?: string;
}
