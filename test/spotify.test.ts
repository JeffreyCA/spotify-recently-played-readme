import { describe, expect, it } from 'vitest';
import {
  parseNowPlaying,
  parseProfile,
  parseRecentlyPlayed,
  SpotifyApiError,
} from '../src/spotify';

/**
 * Response-shape handling, which is where a client for this API actually
 * breaks: the fields are heavily nested, several are nullable in practice
 * without saying so, and the endpoints answer with shapes the OpenAPI schema
 * does not document.
 */

describe('parseRecentlyPlayed', () => {
  it('handles the shapes Spotify actually returns', () => {
    const body = JSON.stringify({
      items: [
        {
          played_at: '2023-11-14T22:13:20.000Z',
          track: {
            id: 'abc',
            name: 'Xtal',
            artists: [{ name: 'Aphex Twin' }],
            album: {
              name: 'Selected Ambient Works 85-92',
              release_date: '1992-11-09',
              images: [
                { url: 'https://i.scdn.co/image/big', width: 640, height: 640 },
                { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
                { url: 'https://i.scdn.co/image/mid', width: 300, height: 300 },
              ],
            },
            external_urls: { spotify: 'https://open.spotify.com/track/abc' },
            duration_ms: 292_000,
            explicit: false,
          },
          context: { type: 'playlist', href: 'https://api.spotify.com/v1/playlists/p' },
        },
        // Nothing but the shell: local files and unavailable tracks arrive
        // looking roughly like this.
        { played_at: 'not a date', track: {} },
      ],
    });

    const items = parseRecentlyPlayed(body, 40);

    expect(items).toHaveLength(2);
    expect(items[0]!.track.name).toBe('Xtal');
    expect(items[0]!.track.artists).toEqual(['Aphex Twin']);
    expect(items[0]!.playedAt).toBe(1_700_000_000);

    // Smallest image that still covers the slot, not the first in the array:
    // a 640px cover for a 40px tile is ~60 KB on every profile view.
    expect(items[0]!.track.image).toBe('https://i.scdn.co/image/small');

    expect(items[1]!.track.name).toBe('Unknown track');
    expect(items[1]!.track.artists).toEqual(['Unknown artist']);
    expect(items[1]!.playedAt).toBeNull();
    expect(items[1]!.track.image).toBeNull();
  });

  it('survives an empty or missing items array', () => {
    expect(parseRecentlyPlayed(JSON.stringify({ items: [] }), 40)).toEqual([]);
    expect(parseRecentlyPlayed(JSON.stringify({}), 40)).toEqual([]);
  });
});

describe('parseNowPlaying', () => {
  const track = {
    id: 'live',
    name: 'Windowlicker',
    artists: [{ name: 'Aphex Twin' }],
    album: { name: 'Windowlicker', images: [] },
    duration_ms: 366_000,
  };

  it('reads progress and playing state', () => {
    const parsed = parseNowPlaying(
      JSON.stringify({
        item: track,
        progress_ms: 61_000,
        is_playing: true,
        currently_playing_type: 'track',
      }),
      40,
    );

    expect(parsed?.progressMs).toBe(61_000);
    expect(parsed?.isPlaying).toBe(true);
  });

  it('ignores anything that is not a track', () => {
    // Episodes, ads and unknown items all reach this endpoint. An ad pinned to
    // someone's profile README would be a poor result.
    for (const type of ['episode', 'ad', 'unknown']) {
      expect(
        parseNowPlaying(
          JSON.stringify({ item: track, currently_playing_type: type, is_playing: true }),
          40,
        ),
        type,
      ).toBeNull();
    }

    expect(parseNowPlaying(JSON.stringify({ item: null }), 40)).toBeNull();
  });

  it('treats a null progress as zero rather than NaN', () => {
    const parsed = parseNowPlaying(
      JSON.stringify({ item: track, progress_ms: null, currently_playing_type: 'track' }),
      40,
    );
    expect(parsed?.progressMs).toBe(0);
  });
});

describe('parseProfile', () => {
  it('reads the fields that come back without extra scopes', () => {
    // The OpenAPI schema lists user-read-private and user-read-email on /me,
    // but those gate country/email/product/explicit_content - all deprecated
    // and none of them read here.
    const profile = parseProfile(
      JSON.stringify({
        id: 'jeffreyca16',
        display_name: 'Jeffrey',
        images: [
          { url: 'https://i.scdn.co/image/big', width: 640, height: 640 },
          { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
        ],
        external_urls: { spotify: 'https://open.spotify.com/user/jeffreyca16' },
      }),
      22,
    );

    expect(profile.id).toBe('jeffreyca16');
    expect(profile.displayName).toBe('Jeffrey');
    expect(profile.image).toBe('https://i.scdn.co/image/small');
  });

  it('copes with a null display name and no picture', () => {
    const profile = parseProfile(JSON.stringify({ id: 'x', display_name: null }), 22);
    expect(profile.displayName).toBe('');
    expect(profile.image).toBeNull();
  });
});

describe('SpotifyApiError', () => {
  it('separates a dead token from a missing scope', () => {
    // The distinction is the whole reason existing users keep working: every
    // account authorized against the Vercel app granted only
    // user-read-recently-played, so now-playing answers 403 for all of them.
    const unauthorized = new SpotifyApiError('Bad token', 401);
    expect(unauthorized.isUnauthorized).toBe(true);
    expect(unauthorized.isForbidden).toBe(false);

    const forbidden = new SpotifyApiError('Insufficient client scope', 403);
    expect(forbidden.isForbidden).toBe(true);
    expect(forbidden.isUnauthorized).toBe(false);

    expect(new SpotifyApiError('Slow down', 429, 30).retryAfter).toBe(30);
  });
});
