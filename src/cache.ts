/**
 * Upstream caching: what the Worker fetches, not what it returns.
 *
 *   Layer 1  reader <- edge     Workers Cache, the rendered card   (wrangler.jsonc)
 *   Layer 2  Worker <- upstream this module
 *
 * Layer 1 absorbs repeat views of one card URL. This module is still worth
 * having on top of it, because the two are keyed differently:
 *
 * - One account's data backs many cache keys. `?count=3&theme=dark` and
 *   `?count=5&theme=light` are separate entries at the edge but the same
 *   recently-played response.
 * - Cover art outlives the card. Art is immutable and cached for ~24h, while
 *   the card expires every ~60s; without this layer every regeneration would
 *   re-download every cover, which is the slowest part of a cold render.
 *
 * Important: the (legacy, zone-level) Cache API is a no-op on *.workers.dev,
 * where there is no zone. We therefore fall back to a per-isolate in-memory
 * map, which still collapses bursts hitting the same isolate and makes local
 * `wrangler dev` behave sensibly. Workers Cache is the zoneless one, but it
 * caches responses, so it cannot serve this purpose.
 *
 * Access tokens are deliberately NOT stored here - see `memoOnly*` below.
 */

interface MemoEntry {
  value: string;
  expiresAt: number;
}

/**
 * Structural subset of ExecutionContext. Hono and @cloudflare/workers-types
 * each declare their own incompatible `ExecutionContext`, and we only ever need
 * `waitUntil`, so we depend on the shape rather than either nominal type.
 */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

const memo = new Map<string, MemoEntry>();
const MEMO_MAX_ENTRIES = 500;

function memoGet(key: string): string | null {
  const hit = memo.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memo.delete(key);
    return null;
  }
  return hit.value;
}

function memoSet(key: string, value: string, ttlSeconds: number): void {
  // Cheap bounded eviction: drop the oldest insertion when full.
  if (memo.size >= MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Cache API keys must be URLs; this namespace is never actually fetched. */
function cacheRequest(key: string): Request {
  return new Request(`https://cache.internal/${encodeURIComponent(key)}`);
}

export async function cacheGet(key: string): Promise<string | null> {
  const local = memoGet(key);
  if (local !== null) return local;

  try {
    const hit = await caches.default.match(cacheRequest(key));
    if (hit) return await hit.text();
  } catch {
    // Cache API unavailable (workers.dev, or test environment). Memo only.
  }
  return null;
}

export async function cachePut(
  key: string,
  value: string,
  ttlSeconds: number,
  ctx?: WaitUntilCtx,
): Promise<void> {
  memoSet(key, value, ttlSeconds);

  const write = (async () => {
    try {
      await caches.default.put(
        cacheRequest(key),
        new Response(value, {
          headers: {
            'Cache-Control': `public, max-age=${ttlSeconds}`,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }),
      );
    } catch {
      // Non-fatal: the memo layer already holds the value.
    }
  })();

  // Don't make the user wait on a cache write.
  if (ctx) ctx.waitUntil(write);
  else await write;
}

/**
 * Isolate-local only, never the Cache API.
 *
 * Used for bearer tokens - the user's Spotify access token and our Google
 * access token. Both are credentials, and the Cache API persists to disk at the
 * edge and (in dev) to `.wrangler/state`. An in-memory map dies with the
 * isolate, which is the correct lifetime for a credential and costs only an
 * occasional extra refresh.
 */
export function memoOnlyGet(key: string): string | null {
  return memoGet(key);
}

export function memoOnlySet(key: string, value: string, ttlSeconds: number): void {
  memoSet(key, value, ttlSeconds);
}

export function memoOnlyDelete(key: string): void {
  memo.delete(key);
}
