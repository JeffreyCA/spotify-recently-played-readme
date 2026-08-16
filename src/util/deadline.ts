/**
 * Shared request deadline.
 *
 * Camo abandons an origin after ~10s (CAMO_SOCKET_TIMEOUT), and a request that
 * dies at the proxy renders as a broken image with no explanation. Independent
 * per-call timeouts don't protect against that, because they add up - and this
 * card has more upstream steps than the Last.fm one: a Firebase read, possibly
 * a token refresh, one or two Spotify calls, then cover art.
 *
 * So the whole request shares one budget. Album art, which is decorative, gets
 * whatever is left; if too little remains it is skipped and the card renders
 * with placeholder tiles rather than risking the entire image.
 */
export class Deadline {
  private readonly startedAt: number;

  constructor(
    private readonly totalMs: number,
    startedAt: number = Date.now(),
  ) {
    this.startedAt = startedAt;
  }

  /** Milliseconds left in the overall budget. */
  remaining(): number {
    return Math.max(0, this.totalMs - (Date.now() - this.startedAt));
  }

  /** The smaller of `maxMs` and whatever is left. */
  slice(maxMs: number): number {
    return Math.min(maxMs, this.remaining());
  }
}

/**
 * Total wall-clock budget for a widget request. Deliberately ~2s below Camo's
 * ~10s ceiling so a slow-but-successful render still reaches the proxy.
 */
export const TOTAL_BUDGET_MS = 8000;

/** Reading the token node out of the Realtime Database. */
export const FIREBASE_BUDGET_MS = 2500;

/** Minting a Google access token, on the isolate-cache miss path. */
export const GOOGLE_TOKEN_BUDGET_MS = 2500;

/** One Spotify Web API call, or the token refresh. */
export const SPOTIFY_BUDGET_MS = 3500;

/** Cover art is decorative and fetched in parallel. */
export const ART_BUDGET_MS = 3500;

/** Below this, skip art entirely rather than risk blowing the budget. */
export const MIN_ART_BUDGET_MS = 600;
