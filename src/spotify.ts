import { cacheGet, cachePut, type WaitUntilCtx } from './cache';
import { SPOTIFY_BUDGET_MS } from './util/deadline';

/**
 * Spotify Web API client.
 *
 * Field choices here are read off the published OpenAPI schema rather than the
 * prose docs, because several attractive ones carry `deprecated: true` and are
 * therefore off the table: `popularity` on tracks and artists, `genres` and
 * `followers` on artists, `preview_url`, and `available_markets`. Nothing in
 * this file touches them.
 */

const API_ROOT = 'https://api.spotify.com/v1';

export interface Track {
  id: string;
  name: string;
  artists: string[];
  album: string;
  /** `open.spotify.com` link to the album, or '' when Spotify sent none. */
  albumUrl: string;
  /** Best cover art URL for the requested display size, or null. */
  image: string | null;
  /** `open.spotify.com` link, or '' when Spotify did not send one. */
  url: string;
  durationMs: number;
  explicit: boolean;
}

export interface PlayHistoryItem {
  track: Track;
  /** Epoch seconds. */
  playedAt: number | null;
}

export interface NowPlaying {
  track: Track;
  /** Position within the track when Spotify answered. */
  progressMs: number;
  isPlaying: boolean;
}

export interface Profile {
  id: string;
  displayName: string;
  image: string | null;
}

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds Spotify asked us to wait, from `Retry-After` on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }

  /** The token is dead or was revoked; a fresh one may work. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /**
   * Documented as "bad OAuth request", and in practice rarely what you get.
   *
   * A *missing scope* answers **401 "Permissions missing"**, not 403 - verified
   * against a live token holding only `user-read-recently-played`. That is why
   * `optional()` in index.ts swallows 401 as well, and why this getter is
   * barely used.
   */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

interface RawImage {
  url?: string;
  height?: number | null;
  width?: number | null;
}

/**
 * Smallest image that still covers the slot.
 *
 * Spotify serves roughly 640 / 300 / 64 for album art. A 640px JPEG inlined as
 * base64 for a 40px tile is ~60 KB of a response that is fetched on every
 * profile view, so picking by size matters more here than looking sharp on a
 * 3x display.
 */
function pickImage(images: RawImage[] | undefined, targetPx: number): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;

  const usable = images
    .filter((i): i is RawImage & { url: string } => typeof i?.url === 'string' && i.url.length > 0)
    .sort((a, b) => (a.width ?? a.height ?? 0) - (b.width ?? b.height ?? 0));
  if (usable.length === 0) return null;

  const fit = usable.find((i) => (i.width ?? i.height ?? 0) >= targetPx);
  // Images with no dimensions sort to the front, so the last entry is the
  // safest fallback when nothing declares a size.
  return (fit ?? usable[usable.length - 1]!).url;
}

interface RawTrack {
  id?: string;
  name?: string;
  artists?: { name?: string }[];
  album?: { name?: string; images?: RawImage[]; external_urls?: { spotify?: string } };
  external_urls?: { spotify?: string };
  duration_ms?: number;
  explicit?: boolean;
}

function spotifyUrl(urls: { spotify?: string } | undefined): string {
  return typeof urls?.spotify === 'string' ? urls.spotify : '';
}

function normalizeTrack(raw: RawTrack | undefined, artPx: number): Track {
  const artists = (raw?.artists ?? [])
    .map((a) => (a?.name ?? '').trim())
    .filter((n) => n.length > 0);

  return {
    id: typeof raw?.id === 'string' ? raw.id : '',
    name: (raw?.name ?? '').trim() || 'Unknown track',
    artists: artists.length > 0 ? artists : ['Unknown artist'],
    album: (raw?.album?.name ?? '').trim(),
    albumUrl: spotifyUrl(raw?.album?.external_urls),
    image: pickImage(raw?.album?.images, artPx),
    url: spotifyUrl(raw?.external_urls),
    durationMs: Number.isFinite(raw?.duration_ms) ? (raw!.duration_ms as number) : 0,
    explicit: raw?.explicit === true,
  };
}

async function call(
  path: string,
  accessToken: string,
  timeoutMs: number,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new SpotifyApiError(aborted ? 'Spotify timed out' : 'Could not reach Spotify', 0);
  }

  if (response.ok || response.status === 204) return response;

  // Documented shape is `{ error: { status, message } }`. The message is worth
  // surfacing on the card: it is the difference between "token expired" and
  // "this app is in development mode and you are not on the allowlist".
  let message = `Spotify error (HTTP ${response.status})`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* keep the generic message */
  }

  const retryAfterRaw = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  const retryAfter = Number.isFinite(retryAfterRaw) ? retryAfterRaw : null;

  throw new SpotifyApiError(message, response.status, retryAfter);
}

export interface RecentlyPlayedOptions {
  accessToken: string;
  /** Spotify caps this at 50. */
  limit: number;
  artPx: number;
  cacheSeconds: number;
  cacheKeyUser: string;
  timeoutMs?: number;
  ctx?: WaitUntilCtx;
}

export function parseRecentlyPlayed(body: string, artPx: number): PlayHistoryItem[] {
  const parsed = JSON.parse(body) as {
    items?: { track?: RawTrack; played_at?: string }[];
  };

  return (parsed?.items ?? []).map((item) => {
    const played = Date.parse(item?.played_at ?? '');
    return {
      track: normalizeTrack(item?.track, artPx),
      playedAt: Number.isFinite(played) ? Math.floor(played / 1000) : null,
    };
  });
}

export async function getRecentlyPlayed({
  accessToken,
  limit,
  artPx,
  cacheSeconds,
  cacheKeyUser,
  timeoutMs = SPOTIFY_BUDGET_MS,
  ctx,
}: RecentlyPlayedOptions): Promise<PlayHistoryItem[]> {
  // Keyed by the raw payload rather than the rendered card, so every theme and
  // width for one account shares a single upstream call. Case-sensitive: the
  // Realtime Database key is, so two casings are genuinely two accounts.
  const key = `spotify:recent:v1:${cacheKeyUser}:${limit}`;

  const cached = await cacheGet(key);
  if (cached !== null) {
    try {
      return parseRecentlyPlayed(cached, artPx);
    } catch {
      /* refetch on a corrupt entry */
    }
  }

  const response = await call(`/me/player/recently-played?limit=${limit}`, accessToken, timeoutMs);
  const body = await response.text();
  const items = parseRecentlyPlayed(body, artPx);
  await cachePut(key, body, cacheSeconds, ctx);
  return items;
}

export function parseNowPlaying(body: string, artPx: number): NowPlaying | null {
  const parsed = JSON.parse(body) as {
    item?: RawTrack | null;
    progress_ms?: number | null;
    is_playing?: boolean;
    currently_playing_type?: string;
  };

  // `episode`, `ad` and `unknown` all reach this endpoint. Only tracks have the
  // fields this card draws, and an ad is not something anyone wants pinned to
  // their profile.
  if (!parsed?.item || parsed.currently_playing_type !== 'track') return null;

  return {
    track: normalizeTrack(parsed.item, artPx),
    progressMs: Number.isFinite(parsed.progress_ms) ? (parsed.progress_ms as number) : 0,
    isPlaying: parsed.is_playing === true,
  };
}

export interface NowPlayingOptions {
  accessToken: string;
  artPx: number;
  cacheSeconds: number;
  cacheKeyUser: string;
  timeoutMs?: number;
  ctx?: WaitUntilCtx;
}

export async function getNowPlaying({
  accessToken,
  artPx,
  cacheSeconds,
  cacheKeyUser,
  timeoutMs = SPOTIFY_BUDGET_MS,
  ctx,
}: NowPlayingOptions): Promise<NowPlaying | null> {
  const key = `spotify:now:v1:${cacheKeyUser}`;

  const cached = await cacheGet(key);
  if (cached !== null) {
    if (cached === '') return null;
    try {
      return parseNowPlaying(cached, artPx);
    } catch {
      /* refetch on a corrupt entry */
    }
  }

  const response = await call('/me/player/currently-playing', accessToken, timeoutMs);

  // 204 with an empty body is how this endpoint says "nothing is playing". The
  // OpenAPI schema documents only 200/401/403/429, so this is not discoverable
  // from the spec - it just arrives, and `response.json()` throws on it.
  const body = response.status === 204 ? '' : await response.text();
  if (body.trim() === '') {
    await cachePut(key, '', cacheSeconds, ctx);
    return null;
  }

  const parsed = parseNowPlaying(body, artPx);
  await cachePut(key, body, cacheSeconds, ctx);
  return parsed;
}

export function parseProfile(body: string, avatarPx: number): Profile {
  const parsed = JSON.parse(body) as {
    id?: string;
    display_name?: string | null;
    images?: RawImage[];
  };

  return {
    id: (parsed?.id ?? '').trim(),
    displayName: (parsed?.display_name ?? '').trim(),
    image: pickImage(parsed?.images, avatarPx),
  };
}

export interface ProfileOptions {
  accessToken: string;
  avatarPx: number;
  cacheSeconds: number;
  cacheKeyUser: string;
  timeoutMs?: number;
  ctx?: WaitUntilCtx;
}

/**
 * The OpenAPI schema lists `user-read-private` and `user-read-email` as this
 * endpoint's scopes, but those gate the `country`, `email`, `product` and
 * `explicit_content` fields - all of which are deprecated and none of which we
 * read. `id`, `display_name`, `images` and `external_urls` come back with any
 * valid token, which is why the Vercel app has been calling it for years with
 * only `user-read-recently-played`.
 */
export async function getProfile({
  accessToken,
  avatarPx,
  cacheSeconds,
  cacheKeyUser,
  timeoutMs = SPOTIFY_BUDGET_MS,
  ctx,
}: ProfileOptions): Promise<Profile> {
  const key = `spotify:me:v1:${cacheKeyUser}`;

  const cached = await cacheGet(key);
  if (cached !== null) {
    try {
      return parseProfile(cached, avatarPx);
    } catch {
      /* refetch on a corrupt entry */
    }
  }

  const response = await call('/me', accessToken, timeoutMs);
  const body = await response.text();
  const profile = parseProfile(body, avatarPx);
  await cachePut(key, body, cacheSeconds, ctx);
  return profile;
}

/** Uncached, for the OAuth callback, which needs the ID before anything exists. */
export async function fetchUserId(accessToken: string, timeoutMs = SPOTIFY_BUDGET_MS): Promise<Profile> {
  const response = await call('/me', accessToken, timeoutMs);
  return parseProfile(await response.text(), 64);
}
