import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Runs against workerd via @cloudflare/vitest-pool-workers.
 *
 * Everything here works on an unconfigured Worker, and that is a hard rule
 * rather than a convenience. vitest-pool-workers loads `.dev.vars`, so on a
 * development machine the Worker is fully configured while the suite runs,
 * while CI has no secrets at all - a test that needed configuration would pass
 * locally and fail there, and one that reached the happy path would make live
 * Spotify and Firebase calls with real credentials.
 *
 * That rules out the OAuth routes, which answer "Service not configured"
 * before they do anything else. They are left to manual testing.
 */
describe('worker', () => {
  it('answers failures with an SVG at HTTP 200, plus a short TTL and an ETag', async () => {
    // A 4xx would make GitHub show a generic broken-image icon with no
    // explanation, and would poison Camo's cache with the failure.
    const res = await SELF.fetch('https://example.com/svg?user=not%20valid');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    // Cacheable, so Workers Cache can serve and collapse it, but briefly: a
    // failure should not outlive the thing that caused it.
    expect(res.headers.get('cache-control')).toMatch(/^public, max-age=10\b/);
    expect(res.headers.get('etag')).toBeTruthy();
    expect(await res.text()).toContain('Invalid Spotify user ID');
  });

  it('serves the card at /api too, where every existing README points', async () => {
    const res = await SELF.fetch('https://example.com/api?user=not%20valid');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
  });

  it('honours the presentational params even on an error card', async () => {
    const res = await SELF.fetch('https://example.com/svg?user=bad%20name&width=640&theme=light');
    const svg = await res.text();
    expect(svg).toContain('width="640"');
    // The light theme's background, so a failure still matches the shape asked
    // for rather than punching a dark hole into a light README.
    expect(svg).toContain('#ffffff');
  });

  it('reports health without leaking whether individual secrets are set', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; configured: boolean };
    expect(body.ok).toBe(true);
    expect(typeof body.configured).toBe('boolean');
  });
});
