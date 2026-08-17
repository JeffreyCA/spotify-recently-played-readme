/**
 * Structured logging for Workers Logs: an object argument is indexed and
 * queryable, unlike a message string. Event and field names match the Last.fm
 * Worker.
 *
 * Nothing here repeats the invocation log (method, URL, query, status, colo,
 * country, user agent, wall/CPU time) or the traces (subrequest timings). What
 * neither can show is whether the card *worked*: an error card is a valid SVG
 * at HTTP 200, so every failure looks like `status: 200` from outside. That is
 * what `card` is for, and why it fires on success too.
 */

type Level = 'info' | 'warn' | 'error';

/** Field values Workers Logs can index. `undefined` keys are dropped. */
export type LogValue = string | number | boolean | string[] | null | undefined;

export type LogFields = Record<string, LogValue>;

function emit(level: Level, event: string, fields: LogFields): void {
  const line: Record<string, Exclude<LogValue, undefined>> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) line[key] = value;
  }

  // One object, no leading message string: `console.log(msg, obj)` is flattened
  // into a single text message and loses every field.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function logInfo(event: string, fields: LogFields = {}): void {
  emit('info', event, fields);
}

export function logWarn(event: string, fields: LogFields = {}): void {
  emit('warn', event, fields);
}

export function logError(event: string, fields: LogFields = {}): void {
  emit('error', event, fields);
}

/** An unknown catch value as a groupable class name plus free text. */
export function errFields(err: unknown): { err: string; detail: string } {
  if (err instanceof Error) return { err: err.name, detail: err.message };
  return { err: 'unknown', detail: String(err) };
}

/* -------------------------------------------------------------------------- */
/* Who is asking                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How the card was reached: through the legacy Vercel deployment, embedded in a
 * README pointing straight here, opened in a browser (mostly the configurator),
 * or anything else.
 *
 * The raw user agent is already in the invocation log, but it is high
 * cardinality; this collapses it to four values so "how much traffic still
 * comes via Vercel" is a group-by.
 */
export const CLIENTS = ['vercel', 'camo', 'browser', 'other'] as const;
export type Client = (typeof CLIENTS)[number];

export function clientOf(request: Request): Client {
  const ua = request.headers.get('user-agent') ?? '';

  // Wins over Camo on purpose: a README embedding the old Vercel URL goes
  // reader -> Camo -> Vercel -> here, and the question is which deployment the
  // markdown points at. Vercel stamps `x-vercel-id`; the proxy sets its own UA.
  if (request.headers.has('x-vercel-id') || /-vercel-proxy\b/i.test(ua)) return 'vercel';

  if (/camo/i.test(ua) || /camo/i.test(request.headers.get('via') ?? '')) return 'camo';
  if (ua.startsWith('Mozilla/')) return 'browser';
  return 'other';
}

/* -------------------------------------------------------------------------- */
/* The card event                                                             */
/* -------------------------------------------------------------------------- */

/** Closed set, so the field can be grouped by. Shared with the Last.fm Worker. */
export type CardReason =
  | 'bad_options'
  | 'not_configured'
  | 'no_tracks'
  | 'reauthorize'
  | 'rate_limited'
  | 'upstream'
  | 'storage'
  | 'auth'
  | 'unhandled';

/**
 * Failures meaning the *service* is unhealthy rather than that one request
 * could not be served, so an alert on `level = "error"` does not fire every
 * time somebody's token needs reconnecting. `upstream` and `rate_limited` are
 * excluded deliberately: a Spotify outage is real but no deploy fixes it.
 */
const SERVICE_FAULTS = new Set<CardReason>([
  'not_configured',
  'storage',
  'auth',
  'unhandled',
]);

export interface CardTrace {
  client: Client;
  user: string | null;
  path: string;
  startedAt: number;
  /** Optional sections that failed and were dropped. See `optional()`. */
  degraded: string[];
}

export function startCard(request: Request, url: URL): CardTrace {
  return {
    client: clientOf(request),
    // Raw, before validation: a card that failed because the ID was junk is the
    // one worth looking up.
    user: url.searchParams.get('user'),
    // `/svg` or the legacy `/api`, which is what tells us whether `/api` can go.
    path: url.pathname,
    startedAt: Date.now(),
    degraded: [],
  };
}

export type CardResult =
  | { outcome: 'ok'; tracks: number; live: boolean }
  | { outcome: 'error'; reason: CardReason; err?: unknown };

/** One line per card request, exception included, so a failure is one row. */
export function logCard(trace: CardTrace, result: CardResult): void {
  const fields: LogFields = {
    outcome: result.outcome,
    client: trace.client,
    user: trace.user,
    path: trace.path,
    ms: Date.now() - trace.startedAt,
    degraded: trace.degraded.length > 0 ? trace.degraded : undefined,
  };

  if (result.outcome === 'ok') {
    fields.tracks = result.tracks;
    fields.live = result.live;
    logInfo('card', fields);
    return;
  }

  fields.reason = result.reason;

  if (result.err !== undefined) {
    const { err, detail } = errFields(result.err);
    fields.err = err;
    fields.detail = detail;

    // SpotifyApiError carries the upstream status. Read duck-typed so this
    // module keeps no dependency on the API client, and optional so a thrown
    // null cannot turn a rendered error card into a real 500.
    const status = (result.err as { status?: unknown } | null)?.status;
    if (typeof status === 'number') fields.status = status;

    // Only where it points at our own code; an upstream error's stack is the
    // same fetch wrapper every time, and stacks dominate a log's size.
    if (result.reason === 'unhandled' && result.err instanceof Error) {
      fields.stack = result.err.stack ?? null;
    }
  }

  if (SERVICE_FAULTS.has(result.reason)) logError('card', fields);
  else logWarn('card', fields);
}
