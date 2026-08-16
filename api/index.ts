// The `.js` extension is the ESM convention TypeScript expects: it names the
// file as it will exist at runtime. A `.ts` extension type checks but is
// emitted unchanged, leaving the deployed function importing a missing file.
import { DEFAULT_WORKER_ORIGIN, translate } from './_translate.js';

/**
 * The old Vercel endpoint, kept alive as a shim.
 *
 * Every URL ever pasted into a README points here, so this route cannot go
 * away. It renders nothing: it translates the parameters, forwards the
 * request, and passes the SVG back.
 *
 * Two rules inherited from the Worker, because the card is displayed in an
 * `<img>` behind GitHub's Camo proxy:
 *
 * - Never answer 4xx. Camo draws it as a broken image and caches the failure.
 *   Anything that goes wrong here still returns an SVG at 200.
 * - Finish inside Camo's ~10s socket timeout, so a slow Worker degrades to the
 *   fallback card rather than to a broken image.
 */

/** Leaves room for the Worker's own deadline and still lands under Camo's. */
const UPSTREAM_TIMEOUT_MS = 8000;

/** Short TTL for failure cards, so an outage clears as soon as it ends. */
const FALLBACK_MAX_AGE_SECONDS = 10;

/**
 * The Worker returns its own failures as cards at 200, marked with an `err-`
 * ETag. Without this check a momentary outage would be pinned at the edge for
 * the full TTL. A thin contract between the two services, but the only signal
 * that survives, and being wrong costs a long-lived error card rather than a
 * broken one.
 */
function isErrorCard(etag: string | null): boolean {
  return etag?.startsWith('W/"err-') ?? false;
}

/**
 * How long the CDN may serve the last good card if this function itself fails.
 * Nothing here can catch a function timeout or a cold-start crash, and those
 * become a Vercel error page - a broken image in every README pointing at us.
 */
const STALE_IF_ERROR_SECONDS = 86400;

function workerOrigin(): string {
  const configured = process.env.WORKER_ORIGIN?.trim();
  return configured ? configured.replace(/\/+$/, '') : DEFAULT_WORKER_ORIGIN;
}

/** Drawn only when the Worker is unreachable, so it depends on nothing. */
function fallbackCard(width: number): string {
  const height = 84;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Spotify card unavailable">
  <rect width="${width}" height="${height}" rx="10" fill="#151b23" stroke="#2a323d"/>
  <text x="${width / 2}" y="38" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#e9eef5">Spotify card unavailable</text>
  <text x="${width / 2}" y="58" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#7d8b9c">Try again in a moment</text>
</svg>`;
}

/** The Worker's own bounds, so the fallback is the size of the card it replaces. */
function requestedWidth(params: URLSearchParams): number {
  const n = Number.parseInt(params.get('width') ?? '', 10);
  if (!Number.isFinite(n)) return 400;
  return Math.min(1000, Math.max(260, n));
}

/**
 * `s-maxage` is what the old endpoint sent, and it is what makes the CDN cache
 * a function response at all. `max-age` goes alongside because Vercel consumes
 * the CDN directives and strips them.
 *
 * The stale window matches the fresh one rather than multiplying it: a wider
 * window mostly helps sparsely-viewed cards, and for those it is the harmful
 * case - the first view after a quiet spell gets the stale copy.
 */
function svgHeaders(maxAgeSeconds: number, etag: string | null, reusable: boolean): Headers {
  // A failure card gets no stale directives. Serving one after the outage it
  // describes has passed is worse than a cache miss.
  const stale = reusable
    ? `, stale-while-revalidate=${maxAgeSeconds}, stale-if-error=${STALE_IF_ERROR_SECONDS}`
    : '';

  const headers = new Headers({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}${stale}`,
    'X-Content-Type-Options': 'nosniff',
  });
  if (etag) headers.set('ETag', etag);
  return headers;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { params, maxAgeSeconds } = translate(url.searchParams);
    const target = `${workerOrigin()}/svg?${params.toString()}`;

    const forwarded = new Headers({
      Accept: 'image/svg+xml',
      // Identifies this hop in the Worker's logs.
      'User-Agent': 'spotify-recently-played-vercel-proxy',
    });
    // Worth forwarding: the Worker answers with a 304, which costs it no
    // rendering and us no body.
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch) forwarded.set('If-None-Match', ifNoneMatch);

    try {
      const upstream = await fetch(target, {
        headers: forwarded,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (upstream.status === 304) {
        // The confirmed card may itself be an error card.
        const etag = upstream.headers.get('etag') ?? ifNoneMatch;
        const failed = isErrorCard(etag);
        return new Response(null, {
          status: 304,
          headers: svgHeaders(failed ? FALLBACK_MAX_AGE_SECONDS : maxAgeSeconds, etag, !failed),
        });
      }

      // The Worker answers 200 even for a card it could not render, so a
      // non-OK status means the Worker itself is unwell.
      if (!upstream.ok) {
        return new Response(fallbackCard(requestedWidth(url.searchParams)), {
          status: 200,
          headers: svgHeaders(FALLBACK_MAX_AGE_SECONDS, null, false),
        });
      }

      // Read fully before answering. Streaming would start sooner, but a
      // failure partway through leaves a truncated SVG that has already
      // committed to 200 - the broken image this is all trying to avoid.
      const body = request.method === 'HEAD' ? null : await upstream.text();
      const etag = upstream.headers.get('etag');
      const failed = isErrorCard(etag);
      return new Response(body, {
        status: 200,
        headers: svgHeaders(failed ? FALLBACK_MAX_AGE_SECONDS : maxAgeSeconds, etag, !failed),
      });
    } catch (err) {
      console.error('Upstream request failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return new Response(fallbackCard(requestedWidth(url.searchParams)), {
        status: 200,
        headers: svgHeaders(FALLBACK_MAX_AGE_SECONDS, null, false),
      });
    }
  },
};
