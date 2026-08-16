import { describe, expect, it } from 'vitest';
import { isAllowedArtUrl } from '../src/art';
import { OptionsError, parseHexColor, parseOptions } from '../src/options';
import {
  absoluteTime,
  formatDuration,
  relativeTime,
  renderCard,
  safeSpotifyUrl,
  trackTooltip,
} from '../src/render/card';
import type { WidgetOptions } from '../src/options';
import type { NowPlaying, PlayHistoryItem, Track } from '../src/spotify';

/**
 * This covers only the failures that give no diagnostic: a malformed SVG
 * renders as a broken image on GitHub with nothing in any log, and the
 * untrusted inputs would be a security problem rather than a visual one.
 * Layout and styling are verified by looking at the card.
 */

const options: WidgetOptions = {
  user: 'testuser',
  count: 3,
  theme: 'dark',
  width: 400,
  radius: 8,
  art: true,
  header: true,
  time: true,
  logo: true,
  profile: 'header',
  username: 'display',
  avatar: true,
  footer: 'off',
  unique: false,
  nowPlaying: true,
  progress: true,
  duration: false,
  explicit: true,
  album: false,
  bgColor: null,
  textColor: null,
  artistColor: null,
  metaColor: null,
  accentColor: null,
  logoColor: null,
};

/** Deliberately hostile: names like these are what break the document. */
const hostile: Track = {
  id: 't1',
  name: 'Fitter Happier & "Co." <b>',
  artists: ['A\u2019B & C', 'D <script>'],
  album: 'OK Computer & Friends',
  albumUrl: 'https://open.spotify.com/album/xyz',
  image: null,
  url: 'https://open.spotify.com/track/abc',
  durationMs: 222_000,
  explicit: true,
};

const long: Track = {
  id: 't2',
  name: '\u{1F3B5} a very long title that will certainly need truncating somewhere',
  artists: ['Someone'],
  album: '',
  // Hostile on purpose: an unsafe album link must not become an href either.
  albumUrl: 'javascript:alert(1)',
  image: null,
  url: 'javascript:alert(1)',
  durationMs: 0,
  explicit: false,
};

const items: PlayHistoryItem[] = [
  { track: hostile, playedAt: 1_700_000_000 },
  { track: long, playedAt: null },
];

const nowPlaying: NowPlaying = {
  track: { ...hostile, id: 'live', name: 'Live & <dangerous>' },
  progressMs: 61_000,
  isPlaying: true,
};

describe('renderCard', () => {
  it('produces well-formed, escaped SVG for every option combination', () => {
    const variants: Array<Partial<WidgetOptions>> = [
      {},
      { art: false },
      { header: false },
      { logo: false },
      { time: false },
      { duration: true, album: true },
      { explicit: false },
      { progress: false },
      { nowPlaying: false },
      { footer: 'wave' },
      { profile: 'footer-left' },
      { profile: 'footer-right', bgColor: '#101010' },
      { profile: 'off' },
      // `footer` is ignored while the profile occupies the footer.
      { profile: 'footer-right', footer: 'wave' },
      { username: 'id' },
      { username: 'off' },
      { avatar: false },
      { username: 'off', avatar: false },
      { width: 260, footer: 'wave', duration: true },
      { width: 800, count: 10 },
      { count: 1 },
    ];

    // One theme, not all ten: escaping does not depend on the palette, and the
    // outer loop multiplied 44 renders into 440 for no extra coverage. Palette
    // correctness is themes.test.ts's job.
    for (const variant of variants) {
      for (const live of [null, nowPlaying]) {
        const svg = renderCard({
          options: { ...options, ...variant },
          items,
          art: [null, 'data:image/jpeg;base64,AAAA'],
          nowPlaying: live,
          nowPlayingArt: null,
          profile: { id: 'testuser', displayName: 'Test & User', image: null },
          avatarImage: null,
          now: 1_700_003_600_000,
        });

        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        // A single bare ampersand is enough to break the whole image.
        expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
        expect((svg.match(/<text/g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
        expect(svg).not.toContain('<b>');
        expect(svg).not.toContain('<script>');
        expect(svg).not.toContain('javascript:');
      }
    }
  });

  it('animates the live progress bar forward, but holds it when paused', () => {
    // The server only ever sees a snapshot, so a bar that does not move is
    // wrong within seconds - and one that moves while paused is also wrong.
    const at = (isPlaying: boolean) =>
      renderCard({
        options,
        items,
        art: [null, null],
        nowPlaying: { ...nowPlaying, isPlaying },
        now: 1_700_003_600_000,
      });

    expect(at(true)).toContain('linear forwards');
    expect(at(false)).not.toContain('linear forwards');
  });

  it('names Spotify even with the logo switched off', () => {
    const svg = renderCard({
      options: { ...options, logo: false },
      items,
      art: [null, null],
      now: 1_700_003_600_000,
    });

    expect(svg).toContain('<title>Spotify Recently Played');
    expect(svg).toContain('on Spotify');
  });

  it('honours every username mode', () => {
    const at = (username: WidgetOptions['username']) =>
      renderCard({
        options: { ...options, username },
        items,
        art: [null, null],
        profile: { id: 'testuser', displayName: 'Test User', image: null },
        now: 1_700_003_600_000,
      });

    expect(at('display')).toContain('>Test User<');
    expect(at('id')).toContain('>testuser<');
    // `off` still names the account in the accessible title, so attribution
    // and context survive hiding the visible label.
    expect(at('off')).not.toMatch(/font-size="12\.5"[^>]*>[^<]+</);
  });
});

describe('untrusted input', () => {
  it('only links to Spotify over https', () => {
    expect(safeSpotifyUrl('https://open.spotify.com/track/abc')).toBeTruthy();
    for (const bad of [
      'javascript:alert(1)',
      'http://open.spotify.com/track/abc',
      'https://evil.test/x',
      'https://open.spotify.com.evil.test/x',
      'https://open.spotify.com@evil.test/x',
      '',
    ]) {
      expect(safeSpotifyUrl(bad), bad).toBeNull();
    }
  });

  it('only fetches art from Spotify CDNs, so this is not an open proxy', () => {
    for (const good of [
      'https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228',
      'https://mosaic.scdn.co/300/abc',
      'https://spotifycdn.com/x.jpg',
      'https://image-cdn-ak.spotifycdn.com/image/abc',
    ]) {
      expect(isAllowedArtUrl(good), good).toBe(true);
    }

    for (const bad of [
      // A bare endsWith('spotifycdn.com') would accept this.
      'https://evil-spotifycdn.com/x.jpg',
      // A suffix test in the wrong direction would accept these.
      'https://spotifycdn.com.evil.test/x.jpg',
      'https://i.scdn.co.evil.test/x.jpg',
      // A substring test against the whole URL would accept this.
      'https://evil.test/?x=i.scdn.co',
      // Userinfo: the real hostname here is evil.test.
      'https://i.scdn.co@evil.test/x.jpg',
      'http://i.scdn.co/image/abc',
      'http://169.254.169.254/latest/meta-data/',
      'not a url',
      '',
    ]) {
      expect(isAllowedArtUrl(bad), bad).toBe(false);
    }
  });

  it('rejects user IDs that cannot exist in the token store', () => {
    for (const bad of [
      '',
      'has space',
      'inject<svg>',
      '../etc',
      '..',
      'a/b',
      'a.b',
      'a$b',
      'a#b',
      'a[b]',
      'a%2e%2e',
      'a?b',
      'a\u0000b',
      'caf\u00e9',
      'x'.repeat(65),
    ]) {
      expect(
        () => parseOptions(new URLSearchParams(`user=${encodeURIComponent(bad)}`)),
        bad,
      ).toThrow(OptionsError);
    }

    // Case is preserved: Realtime Database keys are case-sensitive, so two
    // casings are genuinely two different accounts.
    expect(parseOptions(new URLSearchParams('user=JeffreyCA16')).user).toBe('JeffreyCA16');
    expect(parseOptions(new URLSearchParams('user=jeffreyca16&count=999')).count).toBe(10);
  });

  it('only accepts strict hex colors', () => {
    for (const [input, expected] of [
      ['1a2b3c', '#1a2b3c'],
      ['ABC', '#aabbcc'],
      ['11223344', '#11223344'],
      // A leading hash is rejected: in a URL it would have to be %23, and
      // accepting it here would encourage `bg_color=#abc`, which silently
      // truncates at the fragment.
      ['#1a2b3c', null],
      ['red', null],
      ['12345', null],
      ['url(x)', null],
      ['" onload="alert(1)', null],
      ['', null],
    ] as const) {
      expect(parseHexColor(input), input).toBe(expected);
    }
  });

  it('routes every color parameter through the same allowlist', () => {
    // They are interpolated into SVG attributes, so a parameter that skipped
    // validation would be an injection hole rather than a styling bug.
    const params = new URLSearchParams({ user: 'jeffreyca16' });
    for (const name of [
      'bg_color',
      'text_color',
      'artist_color',
      'meta_color',
      'accent_color',
      'logo_color',
    ]) {
      params.set(name, '" onload="alert(1)');
    }

    const parsed = parseOptions(params);
    for (const value of [
      parsed.bgColor,
      parsed.textColor,
      parsed.artistColor,
      parsed.metaColor,
      parsed.accentColor,
      parsed.logoColor,
    ]) {
      expect(value).toBeNull();
    }
  });

  it('leaves the logo on the brand green unless asked otherwise', () => {
    expect(parseOptions(new URLSearchParams('user=rj')).logoColor).toBeNull();
    expect(parseOptions(new URLSearchParams('user=rj&logo_color=00ff00')).logoColor).toBe('#00ff00');
  });
});

describe('tooltips', () => {
  it('formats the hover text for a track and a timestamp', () => {
    expect(trackTooltip(hostile)).toBe(
      'Fitter Happier & "Co." <b>\nby A\u2019B & C, D <script>\nfrom OK Computer & Friends',
    );
    // No album line rather than an empty one.
    expect(trackTooltip(long)).toBe(
      '\u{1F3B5} a very long title that will certainly need truncating somewhere\nby Someone',
    );

    // UTC and labelled as such: rendered server-side, so the reader's timezone
    // is unknown and an unlabelled time would be wrong for almost everyone.
    expect(absoluteTime(1_700_000_000)).toBe('Played Nov 14, 2023 at 22:13 UTC');
  });
});

describe('relativeTime', () => {
  it('stays relative at every scale', () => {
    const at = (s: number) => relativeTime(1_000_000_000 - s, 1_000_000_000_000);
    expect(at(5)).toBe('just now');
    expect(at(3_600)).toBe('1h ago');
    expect(at(7 * 86_400)).toBe('1w ago');
    expect(at(31 * 86_400)).toBe('1mo ago');
    // Never an absolute date: rendered server-side, so the reader's timezone
    // and locale are unknown.
    expect(at(3000 * 86_400)).toMatch(/ ago$/);
  });
});

describe('formatDuration', () => {
  it('pads seconds and only shows hours when there are any', () => {
    expect(formatDuration(222_000)).toBe('3:42');
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(0)).toBe('0:00');
  });
});
