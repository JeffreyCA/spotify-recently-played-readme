import { isValidUserId } from './firebase';
import { DEFAULT_THEME, isThemeName, type ThemeName } from './render/themes';

/**
 * Where the profile (picture and/or display name) is placed.
 *
 * Placement is separate from content: `avatar` and `username` say what the
 * profile contains, and this says where it goes. Folding the two together is
 * what made `avatar` look like a header-only switch on the Last.fm card.
 */
export const PROFILE_POSITIONS = ['header', 'footer-left', 'footer-right', 'off'] as const;
export type ProfilePosition = (typeof PROFILE_POSITIONS)[number];

/** Whether the profile sits in the footer, and on which side. */
export function footerProfileAlign(p: ProfilePosition): 'left' | 'right' | null {
  if (p === 'footer-left') return 'left';
  if (p === 'footer-right') return 'right';
  return null;
}

/**
 * What sits below the track list.
 *
 * The Last.fm card offers a stats line here. Spotify has no equivalent: every
 * number it exposes about an account or a track - popularity, followers - is
 * marked deprecated in the API schema, so there is nothing honest to count.
 *
 * The footer holds one thing at a time. When `profile` puts the picture and
 * name down here, that *is* the footer and this is ignored.
 */
export const FOOTER_MODES = ['off', 'wave'] as const;
export type FooterMode = (typeof FOOTER_MODES)[number];

/**
 * Which name the profile shows.
 *
 * - `display` the account's Spotify display name
 * - `id`      the user ID, which is what the URL carries
 * - `off`     no name
 *
 * Two different things: plenty of accounts have a display name that shares
 * nothing with the ID people would search for. `display` costs a `/v1/me`
 * call; `id` does not.
 *
 * Parsed leniently from the old boolean, where `username=1` meant `display`.
 */
export const USERNAME_MODES = ['display', 'id', 'off'] as const;
export type UsernameMode = (typeof USERNAME_MODES)[number];

function parseUsername(raw: string | null): UsernameMode {
  const value = (raw ?? '').trim().toLowerCase();
  if ((USERNAME_MODES as readonly string[]).includes(value)) return value as UsernameMode;
  // Falls back to the old boolean form, where `1` meant the display name.
  return bool(raw, true) ? 'display' : 'off';
}

/**
 * A caller-supplied color.
 *
 * Validated to a strict hex form rather than escaped, because this value is
 * interpolated into an SVG attribute: an allowlist is the only way to be sure
 * nothing else can ride along.
 *
 * A leading `#` is rejected rather than tolerated. In a URL it would have to
 * be written `%23`, and accepting the raw form encourages `bg_color=#abc`,
 * where everything from the `#` is treated as a page anchor and never reaches
 * the server - which looks like the parameter being ignored.
 */
export function parseHexColor(raw: string | null): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) return null;
  if (value.length <= 4) {
    return `#${[...value].map((c) => c + c).join('')}`;
  }
  return `#${value}`;
}

export class OptionsError extends Error {
  constructor(message: string) {
    super(message);
    // Logged as the `err` field; without this every error class reads 'Error'.
    this.name = 'OptionsError';
  }
}

function clampInt(raw: string | null, limit: { min: number; max: number; default: number }): number {
  if (raw === null || raw.trim() === '') return limit.default;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return limit.default;
  return Math.min(limit.max, Math.max(limit.min, n));
}

function bool(raw: string | null, fallback: boolean): boolean {
  if (raw === null || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  const value = (raw ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const LIMITS = {
  count: { min: 1, max: 10, default: 5 },
  width: { min: 260, max: 1000, default: 400 },
  radius: { min: 0, max: 40, default: 10 },
} as const;

/**
 * How many history items to pull when deduplicating.
 *
 * `unique` filters after the fact, so a listener who has had one album on
 * repeat needs a deeper window than `count` to fill the card. Spotify caps the
 * endpoint at 50 and charges the same for any limit, so this takes the lot.
 */
export const UNIQUE_SEARCH_LIMIT = 50;

export interface WidgetOptions {
  user: string;
  count: number;
  theme: ThemeName;
  width: number;
  radius: number;
  art: boolean;
  header: boolean;
  /** Show relative timestamps ("3m ago"). */
  time: boolean;
  /** Spotify logo in the header. Doubles as attribution. */
  logo: boolean;
  /** Where the profile goes. */
  profile: ProfilePosition;
  /** Which name the profile shows. */
  username: UsernameMode;
  /** Include the picture in the profile. Costs one extra upstream call. */
  avatar: boolean;
  /** What sits below the track list. */
  footer: FooterMode;
  /** Drop repeated tracks from the history. */
  unique: boolean;
  /**
   * Pin the live track on top while you are listening.
   *
   * Needs `user-read-currently-playing`, which accounts authorized before this
   * Worker do not have. A 401 drops the row and the history still renders.
   */
  nowPlaying: boolean;
  /** Progress bar under the live row. */
  progress: boolean;
  /** Track length in the meta line. */
  duration: boolean;
  /** Explicit-content badge after the title. */
  explicit: boolean;
  /** Album name after the artist. */
  album: boolean;
  /** Overrides the theme background, or null to keep it. */
  bgColor: string | null;
  /** Overrides the theme's title color; the supporting greys follow it. */
  textColor: string | null;
  /** Overrides the artist line. */
  artistColor: string | null;
  /** Overrides timestamps, durations and the footer. */
  metaColor: string | null;
  /** Overrides the now-playing accent and the title hover color. */
  accentColor: string | null;
  /** Overrides the Spotify logo, which is otherwise their brand green. */
  logoColor: string | null;
}

export { clampInt };

export function parseOptions(params: URLSearchParams): WidgetOptions {
  // `username` says *which* name the profile shows, not whether it exists,
  // and is not an alias for `user`.
  const user = (params.get('user') ?? '').trim();

  if (!user) {
    throw new OptionsError('Missing "user" parameter');
  }
  // The same rule that guards the Realtime Database path, applied at the front
  // door so an invalid ID never reaches an upstream request at all.
  if (!isValidUserId(user)) {
    throw new OptionsError('Invalid Spotify user ID');
  }

  const themeRaw = (params.get('theme') ?? '').trim().toLowerCase();
  const theme: ThemeName = isThemeName(themeRaw) ? themeRaw : DEFAULT_THEME;

  return {
    user,
    theme,
    count: clampInt(params.get('count'), LIMITS.count),
    width: clampInt(params.get('width'), LIMITS.width),
    radius: clampInt(params.get('radius'), LIMITS.radius),
    art: bool(params.get('art'), true),
    header: bool(params.get('header'), true),
    time: bool(params.get('time'), true),
    logo: bool(params.get('logo'), true),
    profile: oneOf(params.get('profile'), PROFILE_POSITIONS, 'header'),
    username: parseUsername(params.get('username')),
    avatar: bool(params.get('avatar'), true),
    footer: oneOf(params.get('footer'), FOOTER_MODES, 'off'),
    unique: bool(params.get('unique'), false),
    // `bool` reads the older `off` spelling, and treats the retired `auto` as
    // the default it always was.
    nowPlaying: bool(params.get('now_playing'), true),
    progress: bool(params.get('progress'), true),
    duration: bool(params.get('duration'), false),
    explicit: bool(params.get('explicit'), true),
    album: bool(params.get('album'), false),
    bgColor: parseHexColor(params.get('bg_color')),
    // All colors go through the same allowlist. These are interpolated into
    // SVG attributes, so validation - not escaping - is what makes them safe.
    textColor: parseHexColor(params.get('text_color')),
    artistColor: parseHexColor(params.get('artist_color')),
    metaColor: parseHexColor(params.get('meta_color')),
    accentColor: parseHexColor(params.get('accent_color')),
    logoColor: parseHexColor(params.get('logo_color')),
  };
}
