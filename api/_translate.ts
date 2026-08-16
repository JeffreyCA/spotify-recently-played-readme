/**
 * Maps the parameters the old Vercel endpoint accepted onto the ones the
 * Cloudflare Worker takes. Kept pure and separate from request handling: the
 * mapping is what needs testing, and none of it needs a network.
 *
 * The rule throughout is to be lenient. The old endpoint answered a bad value
 * with a 400, which in a README is a broken image with no explanation.
 * Anything unrecognised is forwarded or dropped, and real failures are left to
 * the Worker, which draws them as a card.
 */

/** Overridable with `WORKER_ORIGIN` for testing. */
export const DEFAULT_WORKER_ORIGIN = 'https://spotify-recently-played.jeffreyca.workers.dev';

/**
 * How long the card stays fresh. The old endpoint sent `s-maxage=60` and took
 * no parameter for it.
 *
 * Vercel strips `s-maxage` and `stale-while-revalidate` at the edge, so a
 * response carrying only those reached GitHub's image proxy as `max-age=0,
 * must-revalidate` - an edge request per README view. Sending a real `max-age`
 * alongside them is what stops that, which makes this the staleness a reader
 * can actually see.
 */
export const MAX_AGE_SECONDS = 180;

function str(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? '').trim().toLowerCase();
}

export interface Translation {
  /** Query string for the Worker's `/svg` endpoint. */
  params: URLSearchParams;
  maxAgeSeconds: number;
}

export function translate(query: URLSearchParams): Translation {
  const out = new URLSearchParams();

  // Forwarded as given, including when absent: the Worker validates the ID and
  // renders a card explaining what went wrong.
  out.set('user', (query.get('user') ?? '').trim());

  // Raw rather than clamped here - the Worker has its own bounds, and two sets
  // to keep in step is one too many. This is also where the old 400s go away:
  // `width=100` was an error, and is now pulled up to the minimum.
  for (const from of ['count', 'width'] as const) {
    const raw = (query.get(from) ?? '').trim();
    if (raw !== '') out.set(from, raw);
  }

  // The old truthy set - true/1/on/yes - is a subset of the Worker's, and both
  // treat anything else as false, so the raw value carries over.
  const unique = (query.get('unique') ?? '').trim();
  if (unique !== '') out.set('unique', unique);

  // The old endpoint had no `theme`, so there is nothing to translate. Left off
  // unless asked for, so existing embeds pick up the current palette rather
  // than being pinned to `legacy`.
  const theme = str(query, 'theme');
  if (theme !== '') out.set('theme', theme);

  // The old header was the logo and "Recently Played" - the username it looked
  // up was only the link target, never drawn. Defaulted off rather than forced,
  // so an old URL can opt back in the way it can opt into a theme.
  const profile = str(query, 'profile');
  out.set('profile', profile !== '' ? profile : 'off');

  return { params: out, maxAgeSeconds: MAX_AGE_SECONDS };
}
