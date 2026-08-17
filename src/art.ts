import { cacheGet, cachePut, type WaitUntilCtx } from './cache';
import { logWarn } from './log';
import { bytesToBase64 } from './util/base64';
import { ART_BUDGET_MS, MIN_ART_BUDGET_MS } from './util/deadline';

/**
 * Cover art has to be inlined as a data URI: GitHub renders the widget inside
 * an <img>, and an SVG in that context cannot load any external resource.
 *
 * Unlike Last.fm's, Spotify's image URLs are opaque content hashes with no size
 * segment to rewrite, so the size is chosen by picking the right entry out of
 * the `images` array upstream (see `pickImage` in spotify.ts) rather than here.
 */

const MAX_BYTES_PER_IMAGE = 200 * 1024;

/**
 * How long to remember that art could not be fetched. Kept short because most
 * failures here are transient; caching them for long makes one unlucky request
 * blank out a cover for everyone until it expires.
 */
const NEGATIVE_CACHE_SECONDS = 60;

/**
 * Hosts whose images this Worker will fetch.
 *
 * This is the open-proxy boundary. Without it, `?img=` on anyone's server is a
 * request this Worker will make on their behalf, from Cloudflare's network,
 * including at private addresses.
 *
 * `i.scdn.co` is what the Web API returns for album, artist and profile art -
 * it is the only host in the OpenAPI schema's own examples, and the only one
 * the Vercel proxy accepted. `mosaic.scdn.co` serves the generated four-up
 * collages for playlists, and `spotifycdn.com` serves editorial covers.
 */
const ALLOWED_ART_HOSTS = new Set(['i.scdn.co', 'mosaic.scdn.co']);

/** Matched as the exact domain or a true subdomain of it, never as a suffix. */
const ALLOWED_ART_DOMAINS = ['spotifycdn.com'];

/**
 * Host matching is where allowlists usually break, so this is deliberate about
 * how it compares:
 *
 * - `new URL().hostname`, never a substring test on the whole URL, which would
 *   accept `https://evil.test/?x=i.scdn.co`.
 * - `host === d || host.endsWith('.' + d)`, never a bare `endsWith(d)`, which
 *   would accept `evil-spotifycdn.com`.
 * - https only, so a plaintext fetch cannot be substituted.
 * - No userinfo. `https://i.scdn.co@evil.test/x` has hostname `evil.test`, so
 *   the check above already rejects it, but a URL carrying credentials at all
 *   is not something we should be following.
 */
export function isAllowedArtUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;

  const host = url.hostname.toLowerCase();
  if (ALLOWED_ART_HOSTS.has(host)) return true;
  return ALLOWED_ART_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Media types we will inline. An exact allowlist rather than a
 * `startsWith('image/')` check, for two reasons: the value is interpolated
 * into an SVG attribute, and `"` is legal in an HTTP field value; and
 * `image/svg+xml` is an image that would be *parsed* rather than decoded once
 * inlined into a document.
 */
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Fetches and inlines one cover, pushing a short tag onto `failures` for every
 * way that can not happen. All of them end in a placeholder tile and a card
 * that renders perfectly, so counting them is the only way a rotated CDN
 * hostname shows up at all.
 */
async function fetchOne(
  url: string,
  cacheSeconds: number,
  timeoutMs: number,
  failures: string[],
  ctx?: WaitUntilCtx,
): Promise<string | null> {
  const key = `art:v1:${url}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached === '' ? null : cached;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(timeoutMs),
      // The allowlist above only validates the URL we start with. Following a
      // redirect would fetch a host that was never checked, so take the 3xx as
      // a response and let the `res.ok` check below discard it.
      //
      // Must be 'manual', not 'error': Workers implement only 'follow' and
      // 'manual', and 'error' throws a TypeError on the edge - which local
      // `wrangler dev` does not reproduce.
      redirect: 'manual',
    });
    if (!res.ok) {
      failures.push(`http_${res.status}`);
      return null;
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      failures.push('not_image');
      return null;
    }

    const declared = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_BYTES_PER_IMAGE) {
      failures.push('too_large');
      return null;
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES_PER_IMAGE) {
      failures.push('too_large');
      return null;
    }

    const dataUri = `data:${contentType};base64,${bytesToBase64(new Uint8Array(buffer))}`;
    await cachePut(key, dataUri, cacheSeconds, ctx);
    return dataUri;
  } catch (err) {
    failures.push(err instanceof Error ? err.name : 'unknown');
    await cachePut(key, '', NEGATIVE_CACHE_SECONDS, ctx);
    return null;
  }
}

export interface InlineArtOptions {
  urls: (string | null)[];
  cacheSeconds: number;
  /** Time left for art. Art is skipped entirely below MIN_ART_BUDGET_MS. */
  timeoutMs?: number;
  ctx?: WaitUntilCtx;
}

/**
 * Resolves art for every track in parallel. Failures come back as null and the
 * card falls back to a placeholder tile - a missing cover must never take the
 * whole widget down.
 */
export async function inlineArt({
  urls,
  cacheSeconds,
  timeoutMs = ART_BUDGET_MS,
  ctx,
}: InlineArtOptions): Promise<(string | null)[]> {
  const wanted = urls.filter((url): url is string => Boolean(url)).length;

  // Not enough of the shared budget left to risk it; render placeholders.
  if (timeoutMs < MIN_ART_BUDGET_MS) {
    // Means upstream ate the whole budget - the number to tune if it recurs.
    if (wanted > 0) {
      logWarn('art', { skipped: 'deadline', total: wanted, budget_ms: Math.round(timeoutMs) });
    }
    return urls.map(() => null);
  }

  const failures: string[] = [];
  const blockedHosts = new Set<string>();

  const results = await Promise.allSettled(
    urls.map((url) => {
      if (!url) return Promise.resolve(null);
      if (!isAllowedArtUrl(url)) {
        // Never fetched, so `fetchOne` cannot see it. This is the allowlist
        // naming a host Spotify no longer serves from, which is otherwise silent.
        blockedHosts.add(hostOf(url));
        return Promise.resolve(null);
      }
      return fetchOne(url, cacheSeconds, timeoutMs, failures, ctx);
    }),
  );

  const images = results.map((r) => (r.status === 'fulfilled' ? r.value : null));

  // Aggregated, not one line per cover: a broken CDN fails every image on every
  // request, and that is when volume must not multiply by the track count.
  const missing = images.filter((image, i) => urls[i] && image === null).length;
  if (missing > 0) {
    logWarn('art', {
      total: wanted,
      failed: missing,
      errors: [...new Set(failures)],
      blocked_hosts: blockedHosts.size > 0 ? [...blockedHosts] : undefined,
    });
  }

  return images;
}

/** Hostname only: the actionable part, and it keeps the field groupable. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return 'invalid';
  }
}
