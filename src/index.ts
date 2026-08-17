import { Hono, type Context } from 'hono';
import { inlineArt } from './art';
import {
  authorizeUrl,
  exchangeCode,
  forgetAccessToken,
  getAccessToken,
  ReauthorizeError,
  saveTokens,
  SpotifyAuthError,
} from './auth';
import type { WaitUntilCtx } from './cache';
import { randomNonce, signState, timingSafeEqual, verifyState } from './crypto';
import type { Env } from './env';
import { deleteTokenNode, FirebaseError, isConfigured as firebaseConfigured } from './firebase';
import {
  clientOf,
  errFields,
  logCard,
  logError,
  logInfo,
  logWarn,
  startCard,
  type CardReason,
} from './log';
import {
  clampInt,
  LIMITS,
  OptionsError,
  parseOptions,
  UNIQUE_SEARCH_LIMIT,
  type WidgetOptions,
} from './options';
import { connectedPage, confirmDisconnectPage, disconnectedPage, errorPage } from './pages';
import { ART_DISPLAY_PX, AVATAR_DISPLAY_PX, renderCard } from './render/card';
import { renderErrorCard } from './render/error';
import {
  fetchUserId,
  getNowPlaying,
  getProfile,
  getRecentlyPlayed,
  SpotifyApiError,
  type NowPlaying,
  type PlayHistoryItem,
  type Profile,
} from './spotify';
import { ART_BUDGET_MS, Deadline, SPOTIFY_BUDGET_MS, TOTAL_BUDGET_MS } from './util/deadline';
import { weakHash as hash } from './util/hash';

const app = new Hono<{ Bindings: Env }>();

function intVar(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Errors get a short TTL of their own. A typo'd username should not pin a
 * failure card at the edge for a full minute, and a transient Spotify outage
 * should clear as soon as it is over.
 */
const ERROR_MAX_AGE_SECONDS = 10;

/** How long a signed `state` stays valid. Long enough to log in, no longer. */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const STATE_COOKIE = 'sp_state';

function svgResponse(svg: string, etag: string, request: Request, maxAgeSeconds: number): Response {
  const headers: HeadersInit = {
    // Camo only proxies content types on its allowlist. `image/svg+xml` is on
    // it; if the image ever mysteriously fails to render, try dropping the
    // charset suffix as the first debugging step.
    'Content-Type': 'image/svg+xml; charset=utf-8',
    // Matches the upstream TTL, so the edge never holds a card longer than the
    // data behind it was going to be reused anyway. `no-cache` would be
    // fresher, but it forces a Worker run - and a Firebase read, and a token
    // refresh - per view.
    'Cache-Control': `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 5}`,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(svg, { status: 200, headers });
}

function errorResponse(
  request: Request,
  message: string,
  hint: string | undefined,
  params: URLSearchParams,
  maxAgeSeconds = ERROR_MAX_AGE_SECONDS,
  hintHref?: string,
): Response {
  // Error cards honour the presentational params, so a card that fails still
  // matches the shape the reader asked for. Parsed leniently, since the
  // request may well be malformed - that is why we are here.
  const svg = renderErrorCard({
    message,
    hint,
    hintHref,
    theme: params.get('theme') ?? undefined,
    width: clampInt(params.get('width'), LIMITS.width),
    radius: clampInt(params.get('radius'), LIMITS.radius),
  });
  // Deliberately HTTP 200 - see render/error.ts.
  return svgResponse(svg, `W/"err-${hash(svg)}"`, request, maxAgeSeconds);
}

function executionCtx(c: Context<{ Bindings: Env }>): WaitUntilCtx | undefined {
  try {
    // Hono throws here when no ExecutionContext is available (e.g. some tests).
    return c.executionCtx as WaitUntilCtx;
  } catch {
    return undefined;
  }
}

function baseUrl(env: Env): string {
  return (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
}

function missingConfig(env: Env): string | null {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return 'SPOTIFY_CLIENT_ID/SECRET';
  if (!firebaseConfigured(env)) return 'FIREBASE_*';
  if (!env.STATE_SECRET) return 'STATE_SECRET';
  // Without this the Worker runs fine but silently stores refresh tokens in
  // plaintext - the one misconfiguration that leaves no trace, which the
  // later plaintext-removal step assumes can never have happened.
  if (!env.TOKEN_ENC_KEY) return 'TOKEN_ENC_KEY';
  return null;
}

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runs `fn` with an access token, retrying once with a fresh one on 401.
 *
 * The isolate can hold a token that was revoked, or that Spotify decided to
 * invalidate, part-way through its hour. That is the only case worth retrying:
 * everything else either succeeds or is not going to.
 */
async function withAccessToken<T>(
  env: Env,
  user: string,
  ctx: WaitUntilCtx | undefined,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const token = await getAccessToken(env, user, ctx);
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof SpotifyApiError) || !err.isUnauthorized) throw err;
    forgetAccessToken(user);
    return fn(await getAccessToken(env, user, ctx));
  }
}

/**
 * Sections that are not the point of the card fail quietly - including on 401.
 *
 * Swallowing 401 here looks wrong and is not. The OpenAPI schema documents 403
 * for a bad OAuth request, but Spotify actually answers **401 "Permissions
 * missing"** for a missing scope - verified against a live token holding only
 * `user-read-recently-played`, where `/me/player/currently-playing` returns 401
 * and `/me/player/recently-played` returns 200. Rethrowing made
 * `withAccessToken` mint a fresh token, hit the same 401, and fail the entire
 * card for every account that authorized the old Vercel app - all of them.
 *
 * Nothing is lost by not rethrowing: a genuinely dead token fails the primary
 * call too, which drives the retry.
 *
 * The drop is recorded on the card event rather than logged here, since for a
 * legacy account it happens on every request - a line of its own would be the
 * Worker's highest-volume log and say nothing new.
 *
 * `degraded` is per attempt, not per request: `withAccessToken` re-runs the
 * whole callback on a 401, so a discarded attempt's failures must not land on
 * a card that ends up rendering fine.
 */
function optional<T>(
  promise: Promise<T>,
  label: string,
  degraded: string[],
  user: string | null,
): Promise<T | null> {
  return promise.catch((err: unknown) => {
    degraded.push(label);
    // A 401 is the expected legacy case above. Anything else is news.
    if (!(err instanceof SpotifyApiError) || !err.isUnauthorized) {
      logWarn('card.section', `card: ${label} unavailable for ${user ?? '(no user)'}`, {
        section: label,
        user,
        ...errFields(err),
      });
    }
    return null;
  });
}

/** Drops repeated tracks, keeping the most recent play of each. */
function dedupe(items: PlayHistoryItem[]): PlayHistoryItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    // A local file has no id; there is nothing to compare, so it stays.
    if (!item.track.id) return true;
    if (seen.has(item.track.id)) return false;
    seen.add(item.track.id);
    return true;
  });
}

async function handleCard(c: Context<{ Bindings: Env }>): Promise<Response> {
  const request = c.req.raw;
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const ctx = executionCtx(c);
  const trace = startCard(request, url);

  // Every rendered failure exits through here, so `card` fires exactly once.
  const fail = (
    reason: CardReason,
    message: string,
    hint: string | undefined,
    err?: unknown,
    maxAgeSeconds?: number,
    hintHref?: string,
  ): Response => {
    logCard(trace, { outcome: 'error', reason, err });
    return errorResponse(request, message, hint, params, maxAgeSeconds, hintHref);
  };

  let options: WidgetOptions;
  try {
    options = parseOptions(params);
  } catch (err) {
    if (err instanceof OptionsError) {
      return fail('bad_options', err.message, 'Check the ?user= parameter', err);
    }
    throw err;
  }

  const missing = missingConfig(c.env);
  if (missing) {
    return fail('not_configured', 'Service not configured', `Missing ${missing}`);
  }

  const deadline = new Deadline(TOTAL_BUDGET_MS);
  const upstreamCache = intVar(c.env.UPSTREAM_CACHE_SECONDS, 60);
  const nowCache = intVar(c.env.NOW_PLAYING_CACHE_SECONDS, 20);
  const artCache = intVar(c.env.ART_CACHE_SECONDS, 86400);

  try {
    const wantLive = options.nowPlaying;
    // `username=id` is already known from the URL, so only the picture and a
    // display name are worth a `/v1/me` call.
    const wantProfile =
      options.profile !== 'off' && (options.avatar || options.username === 'display');

    // One extra item of headroom, because the live track is usually also the
    // newest history entry and gets filtered out of the list below it.
    const limit = options.unique
      ? UNIQUE_SEARCH_LIMIT
      : Math.min(50, options.count + (wantLive ? 1 : 0));

    const fetched = await withAccessToken(c.env, options.user, ctx, async (accessToken) => {
      const spotifyTimeout = deadline.slice(SPOTIFY_BUDGET_MS);
      const shared = { accessToken, cacheKeyUser: options.user, timeoutMs: spotifyTimeout, ctx };
      // Scoped to this attempt: a 401 re-runs the whole callback.
      const degraded: string[] = [];

      // Run together: the set costs the slowest of the three rather than their
      // sum, which is what keeps a cold render inside Camo's window.
      const [history, live, profile] = await Promise.all([
        getRecentlyPlayed({
          ...shared,
          limit,
          artPx: ART_DISPLAY_PX,
          cacheSeconds: upstreamCache,
        }),
        wantLive
          ? // One row among several: it drops quietly rather than failing the
            // card, which is what keeps pre-Worker accounts working.
            optional(
              getNowPlaying({ ...shared, artPx: ART_DISPLAY_PX, cacheSeconds: nowCache }),
              'now_playing',
              degraded,
              trace.user,
            )
          : Promise.resolve<NowPlaying | null>(null),
        wantProfile
          ? optional(
              getProfile({ ...shared, avatarPx: AVATAR_DISPLAY_PX, cacheSeconds: 300 }),
              'profile',
              degraded,
              trace.user,
            )
          : Promise.resolve<Profile | null>(null),
      ]);

      return { accessToken, history, live, profile, degraded };
    });

    const { live, profile } = fetched;
    trace.degraded = fetched.degraded;

    // Trim before fetching art: with `unique` the history call asks for 50,
    // and downloading fifty covers to show five would be the slowest thing
    // here.
    //
    // This is also the only place track selection happens - `renderCard` draws
    // exactly the rows it's handed - so what comes out of here is final: the
    // live track removed from history, and the list capped at `count` once
    // the live row has taken its slot.
    const deduped = options.unique ? dedupe(fetched.history) : fetched.history;
    const items = deduped
      .filter((item) => !live || !item.track.id || item.track.id !== live.track.id)
      .slice(0, options.count - (live ? 1 : 0));

    if (items.length === 0 && !live) {
      return fail('no_tracks', 'Nothing to show', 'No recently played tracks on this account');
    }

    // Art gets whatever the API calls left behind, so a slow upstream degrades
    // to placeholder tiles instead of blowing Camo's ~10s ceiling.
    const artTimeout = deadline.slice(ART_BUDGET_MS);
    const wantAvatar = wantProfile && options.avatar && Boolean(profile?.image);

    const artUrls = options.art ? items.map((i) => i.track.image) : items.map(() => null);
    const liveArtUrl = options.art ? (live?.track.image ?? null) : null;

    const images = await inlineArt({
      urls: [...artUrls, liveArtUrl, wantAvatar ? profile!.image : null],
      cacheSeconds: artCache,
      timeoutMs: artTimeout,
      ctx,
    });

    const svg = renderCard({
      options,
      items,
      art: images.slice(0, items.length),
      nowPlaying: live,
      nowPlayingArt: images[items.length] ?? null,
      profile,
      avatarImage: images[items.length + 1] ?? null,
    });

    // A card with a live row goes stale faster than pure history: the progress
    // bar animates forward from a snapshot, which has to stay roughly current
    // for that to be honest.
    logCard(trace, { outcome: 'ok', tracks: items.length, live: Boolean(live) });
    return svgResponse(svg, `W/"${hash(svg)}"`, request, live ? nowCache : upstreamCache);
  } catch (err) {
    return cardError(err, c.env, fail);
  }
}

/** Signature of the per-request `fail` closure built in `handleCard`. */
type Fail = (
  reason: CardReason,
  message: string,
  hint: string | undefined,
  err?: unknown,
  maxAgeSeconds?: number,
  hintHref?: string,
) => Response;

function reauthorizeCard(env: Env, fail: Fail, err?: unknown): Response {
  const base = baseUrl(env);
  return fail(
    'reauthorize',
    'Spotify authorization needed',
    `Reconnect at ${base.replace(/^https?:\/\//, '')}`,
    err,
    ERROR_MAX_AGE_SECONDS,
    // `/login` rather than the configurator: the reader already knows what they
    // want. Skipped when PUBLIC_BASE_URL is unset, since a relative href in a
    // card embedded on another origin would resolve against that origin.
    base ? `${base}/login` : undefined,
  );
}

function cardError(err: unknown, env: Env, fail: Fail): Response {
  if (err instanceof ReauthorizeError) {
    return reauthorizeCard(env, fail, err);
  }

  if (err instanceof SpotifyApiError) {
    if (err.status === 429) {
      // Honour Retry-After in the response rather than sleeping on it: the
      // edge can hold the answer for free, whereas blocking here spends the
      // Camo budget and risks a broken image on top of the rate limit.
      const wait = Math.min(600, Math.max(ERROR_MAX_AGE_SECONDS, err.retryAfter ?? 60));
      return fail(
        'rate_limited',
        'Spotify is rate limiting',
        `Trying again in about ${wait}s`,
        err,
        wait,
      );
    }
    if (err.isUnauthorized || err.isForbidden) {
      return reauthorizeCard(env, fail, err);
    }
    return fail('upstream', err.message, 'Try again in a moment', err);
  }

  // Split so an alert can tell "the database is unreachable" from "our Spotify
  // credentials are wrong" without reading the message.
  if (err instanceof FirebaseError) {
    return fail('storage', 'Something went wrong', 'Try again in a moment', err);
  }
  if (err instanceof SpotifyAuthError) {
    return fail('auth', 'Something went wrong', 'Try again in a moment', err);
  }

  return fail('unhandled', 'Something went wrong', 'Try again in a moment', err);
}

app.get('/svg', handleCard);
// The Vercel app served the card at `/api`, and every existing README points
// there. Keeping the path costs nothing and makes those redirects trivial.
app.get('/api', handleCard);

/* -------------------------------------------------------------------------- */
/* OAuth                                                                      */
/* -------------------------------------------------------------------------- */

function stateCookie(value: string, maxAgeSeconds: number): string {
  // Deliberately not `__Host-` prefixed: that would forbid any `Path` but `/`
  // and require a secure origin - and while 127.0.0.1 counts as one, the
  // prefix still buys nothing here. The HMAC on the state binds the callback
  // to us; this cookie is only the second half of a double submit.
  // SameSite=Lax is what lets it survive the top-level navigation back from
  // accounts.spotify.com.
  return `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

async function startAuth(
  c: Context<{ Bindings: Env }>,
  intent: 'connect' | 'disconnect',
): Promise<Response> {
  const missing = missingConfig(c.env);
  if (missing) return errorPage('Service not configured', `Missing ${missing}`, 500);

  const nonce = randomNonce();
  const state = await signState({ nonce, iat: Date.now(), intent }, c.env.STATE_SECRET!);

  // The whole OAuth flow is logged: it runs once per user rather than once per
  // view, and `start` against `connected` is the only way to see people falling
  // out of it.
  logInfo('oauth', `oauth: ${intent} started`, { step: 'start', intent, client: clientOf(c.req.raw) });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(c.env, state, intent === 'connect'),
      'Set-Cookie': stateCookie(nonce, STATE_MAX_AGE_MS / 1000),
      'Cache-Control': 'no-store',
    },
  });
}

app.get('/login', (c) => startAuth(c, 'connect'));

// Deleting a user's tokens cannot be driven by a `?user=` parameter, or anyone
// could wipe anyone's. Bouncing through Spotify proves who is asking, and
// `show_dialog=false` makes it a redirect rather than a second consent screen.
//
// The confirmation page in front of it exists because the bounce is silent
// for anyone already signed in to Spotify: without it, a stray click deletes
// the tokens and breaks every embedded card with no chance to stop.
app.get('/disconnect', (c) => {
  if (c.req.query('confirm') !== '1') return confirmDisconnectPage();
  return startAuth(c, 'disconnect');
});

app.get('/callback', async (c) => {
  const missing = missingConfig(c.env);
  if (missing) return errorPage('Service not configured', `Missing ${missing}`, 500);

  const params = new URL(c.req.url).searchParams;
  const clear = stateCookie('', 0);

  const denied = params.get('error');
  if (denied) {
    logInfo('oauth', `oauth: Spotify did not authorize (${denied})`, {
      step: 'denied',
      reason: denied,
    });
    const response = errorPage(
      'Spotify did not authorize',
      denied === 'access_denied'
        ? 'You declined the request, so nothing was stored.'
        : `Spotify reported: ${denied}`,
    );
    response.headers.append('Set-Cookie', clear);
    return response;
  }

  const code = params.get('code');
  const rawState = params.get('state') ?? '';
  const cookie = readCookie(c.req.raw, STATE_COOKIE);

  const state = await verifyState(rawState, c.env.STATE_SECRET!, STATE_MAX_AGE_MS);
  if (!code || !state || !cookie || !timingSafeEqual(state.nonce, cookie)) {
    // Usually an expired link or a reopened tab, but this is also what a forged
    // callback looks like, so it is worth being able to see a run of them.
    logWarn('oauth', 'oauth: callback state did not verify', {
      step: 'state_invalid',
      has_code: Boolean(code),
      has_state: Boolean(state),
      has_cookie: Boolean(cookie),
    });
    const response = errorPage(
      'That link has expired',
      'Start again from the configurator. Authorization links are only valid for a few minutes.',
    );
    response.headers.append('Set-Cookie', clear);
    return response;
  }

  try {
    const tokens = await exchangeCode(c.env, code);
    const profile = await fetchUserId(tokens.access_token);
    if (!profile.id) throw new SpotifyAuthError('Spotify did not return a user ID');

    let response: Response;

    if (state.intent === 'disconnect') {
      await deleteTokenNode(c.env, profile.id);
      forgetAccessToken(profile.id);
      logInfo('oauth', `oauth: disconnected ${profile.id}`, {
        step: 'disconnected',
        user: profile.id,
      });
      response = disconnectedPage(profile.id);
    } else {
      if (!tokens.refresh_token) throw new SpotifyAuthError('Spotify did not return a refresh token');
      // Awaited, unlike the Vercel app's fire-and-forget write: the page we are
      // about to render tells the user they are connected, and it must not say
      // that before the tokens are actually stored.
      await saveTokens(c.env, profile.id, tokens.access_token, tokens.refresh_token);
      forgetAccessToken(profile.id);
      logInfo('oauth', `oauth: connected ${profile.id}`, { step: 'connected', user: profile.id });
      response = connectedPage(profile.id, baseUrl(c.env));
    }

    response.headers.append('Set-Cookie', clear);
    return response;
  } catch (err) {
    logError('oauth', `oauth: ${state.intent} failed`, {
      step: 'failed',
      intent: state.intent,
      ...errFields(err),
    });
    const response = errorPage(
      'Could not finish connecting',
      err instanceof Error ? err.message : 'Try again in a moment.',
      502,
    );
    response.headers.append('Set-Cookie', clear);
    return response;
  }
});

app.get('/health', (c) =>
  c.json({
    ok: true,
    configured: missingConfig(c.env) === null,
    time: new Date().toISOString(),
  }),
);

// Static assets are served before the Worker runs, so anything reaching here is
// genuinely unmatched.
app.notFound((c) => c.text('Not found', 404));

export default app;
