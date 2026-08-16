import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/index';

const CARD = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

function stubUpstream(response: Response | (() => Promise<Response>)): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    typeof response === 'function' ? await response() : response.clone(),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function get(query: string, headers?: Record<string, string>): Request {
  return new Request(`https://spotify-recently-played-readme.vercel.app/api?${query}`, { headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('proxy', () => {
  it('calls the Worker with translated parameters and returns its card', async () => {
    const fetchMock = stubUpstream(
      new Response(CARD, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', ETag: 'W/"abc"' },
      }),
    );

    const res = await handler.fetch(get('user=jeffreyca16&count=3'));
    const target = new URL(fetchMock.mock.calls[0]![0] as string);

    expect(target.origin).toBe('https://spotify-recently-played.jeffreyca.workers.dev');
    expect(target.pathname).toBe('/svg');
    expect(target.searchParams.get('user')).toBe('jeffreyca16');
    expect(target.searchParams.get('count')).toBe('3');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=180, s-maxage=180, stale-while-revalidate=180, stale-if-error=86400',
    );
    expect(res.headers.get('etag')).toBe('W/"abc"');
    expect(await res.text()).toBe(CARD);
  });

  it('passes a conditional request through and answers 304 with no body', async () => {
    const fetchMock = stubUpstream(
      new Response(null, { status: 304, headers: { ETag: 'W/"abc"' } }),
    );

    const res = await handler.fetch(get('user=a', { 'If-None-Match': 'W/"abc"' }));
    const sent = fetchMock.mock.calls[0]![1] as RequestInit;

    expect(new Headers(sent.headers).get('if-none-match')).toBe('W/"abc"');
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  it("does not pin the Worker's error cards for a full TTL", async () => {
    stubUpstream(
      new Response(CARD, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', ETag: 'W/"err-abc"' },
      }),
    );

    const res = await handler.fetch(get('user=zzz'));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10, s-maxage=10');
  });

  it('answers 200 with a fallback card when the Worker fails', async () => {
    stubUpstream(new Response('boom', { status: 502 }));

    const res = await handler.fetch(get('user=a'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    // The failure card must not outlive the failure it describes.
    expect(res.headers.get('cache-control')).toBe('public, max-age=10, s-maxage=10');
    expect(await res.text()).toContain('<svg');
  });

  it('answers 200 with a fallback card when the Worker cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubUpstream(async () => {
      throw new Error('network down');
    });

    const res = await handler.fetch(get('user=a'));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('unavailable');
  });
});
