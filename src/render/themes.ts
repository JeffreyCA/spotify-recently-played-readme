import { contrastRatio, isLight, mix, parseRgba } from './color';

export interface Theme {
  /** Card background. `none` renders a transparent card. */
  bg: string;
  /** Card outline. 'none' on the transparent theme. */
  border: string;
  /** Track title color. */
  title: string;
  /** Artist / secondary line color. */
  artist: string;
  /** Timestamp, duration and footer color. */
  meta: string;
  /** Now-playing accent: equaliser bars, the label, the progress fill. */
  accent: string;
  /** Placeholder tile fill when cover art or an avatar is missing. */
  placeholder: string;
  /** Glyph color drawn on top of `placeholder`. */
  placeholderInk: string;
  /** Unplayed remainder of the now-playing progress bar. */
  progressTrack: string;
  /** Hairline rule between track rows. Should be barely perceptible. */
  divider: string;
  /** Track title color on hover, where the SVG is interactive. */
  titleHover: string;
}

export const THEMES = {
  /**
   * Neutral-cool charcoal (#151B23). The supporting greys carry the same
   * slight blue cast as the background; pure neutral greys read as muddy
   * against it, and GitHub-blue greys read as purple.
   */
  dark: {
    bg: '#151b23',
    border: '#2a323d',
    title: '#e9eef5',
    artist: '#9fadbd',
    meta: '#7d8b9c',
    accent: '#1db954',
    placeholder: '#1d242e',
    // Deliberately higher contrast against its tile than a mid-tone theme
    // needs. The same ratio reads weaker the darker the backdrop, and the
    // avatar glyph is small and fine-lined.
    placeholderInk: '#435060',
    progressTrack: '#3f454d',
    divider: '#232b36',
    titleHover: '#1db954',
  },
  /**
   * Spotify's own near-black. This is the closest thing to the card the
   * Vercel app rendered, so it is what an existing user should switch to if
   * the new default looks unfamiliar.
   */
  spotify: {
    bg: '#121212',
    border: '#2a2a2a',
    title: '#ffffff',
    artist: '#b3b3b3',
    meta: '#8a8a8a',
    accent: '#1db954',
    placeholder: '#1f1f1f',
    placeholderInk: '#4d4d4d',
    progressTrack: '#414141',
    divider: '#242424',
    titleHover: '#1db954',
  },
  /**
   * The neutral charcoal the Vercel card used. Kept as its own theme rather
   * than folded into `dark`: hue-free greys sit differently against #212121
   * than the blue-tinted set does against #151b23.
   *
   * The greys are the Last.fm card's `legacy` palette, which was measured
   * against this same background - only the accent differs, and brand green
   * reads at 6.23 here.
   */
  legacy: {
    bg: '#212121',
    border: '#2f2f2f',
    title: '#f0f0f0',
    artist: '#b0b0b0',
    meta: '#8a8a8a',
    accent: '#1db954',
    placeholder: '#2b2b2b',
    // Lifted off the derived value for the same reason as `dark`'s: the same
    // ratio reads weaker the darker the backdrop, and the avatar glyph is
    // small and fine-lined.
    placeholderInk: '#585858',
    // Between the placeholder and its ink: the unplayed remainder has to be
    // visible without competing with the fill sitting on top of it.
    progressTrack: '#454545',
    divider: '#2e2e2e',
    titleHover: '#1db954',
  },
  /**
   * Radical (dhedgecock/radical-vscode). Colors taken from the theme's own
   * source rather than sampled from a screenshot:
   *
   *   bg              PRIMARY_BACKGROUND, the editor background
   *   border/divider  a desaturated step up from the background
   *   title           BLUE_100
   *   artist          PINKS[300], its `storage` token
   *   meta            BLUE_200, the editor foreground
   *   accent          PRIMARY, the signature hot pink
   *
   * The border and divider are the exception to "taken from the source".
   * BORDERS[200] and BORDERS[100] are saturated indigos - chroma 60 and 44,
   * against 16-23 for every other palette here - and at hairline weight that
   * reads as a stripe rather than as an edge. Both are muted to the chroma the
   * rest of the file uses, keeping the purple and the luminance step.
   *
   * The accent stays pink rather than becoming Spotify green: this palette is
   * the whole point of choosing it, and green against these purples reads as a
   * mistake. The logo is unaffected - `logo_color` is brand green in every
   * theme.
   */
  radical: {
    bg: '#141322',
    border: '#2f2d44',
    title: '#d0fff4',
    artist: '#f37ab0',
    meta: '#7c9c9e',
    accent: '#ff428e',
    placeholder: '#1c1a30',
    placeholderInk: '#415e6c',
    progressTrack: '#3a424c',
    divider: '#26243c',
    titleHover: '#ff428e',
  },
  light: {
    bg: '#ffffff',
    border: '#d0d7de',
    title: '#1f2328',
    artist: '#59636e',
    meta: '#818b98',
    // Not brand green: #1db954 on white is 2.3:1, which is unreadable for the
    // "Listening now" label. This is that green darkened to 5.4:1. The logo
    // is unaffected - `logo_color` defaults to brand green in every theme,
    // because that mark is a trademark and this one is not.
    accent: '#137a3f',
    placeholder: '#eaeef2',
    placeholderInk: '#c8d1da',
    progressTrack: '#d2d3d4',
    divider: '#eaeef2',
    titleHover: '#137a3f',
  },
  nord: {
    bg: '#2e3440',
    border: '#3b4252',
    title: '#eceff4',
    artist: '#88c0d0',
    meta: '#7b88a1',
    accent: '#88c0d0',
    placeholder: '#3b4252',
    placeholderInk: '#4c566a',
    progressTrack: '#545964',
    divider: '#3b4252',
    titleHover: '#88c0d0',
  },
  catppuccin: {
    bg: '#1e1e2e',
    border: '#313244',
    title: '#cdd6f4',
    artist: '#cba6f7',
    meta: '#7f849c',
    accent: '#a6e3a1',
    placeholder: '#313244',
    placeholderInk: '#45475a',
    progressTrack: '#414356',
    divider: '#313244',
    titleHover: '#a6e3a1',
  },
  transparent: {
    bg: 'none',
    border: 'none',
    title: '#8b949e',
    artist: '#8b949e',
    meta: '#6e7681',
    accent: '#1db954',
    placeholder: '#6e768133',
    placeholderInk: '#8b949e55',
    progressTrack: '#8b949e44',
    divider: '#8b949e33',
    titleHover: '#1db954',
  },
  dracula: {
    bg: '#282a36',
    border: '#44475a',
    title: '#f8f8f2',
    artist: '#bd93f9',
    // Lifted off Dracula's #6272a4 comment colour, which is built to recede in
    // code and left the timestamp at 3.0 against the card. This is that colour
    // toward the foreground, so it stays in the palette's family.
    meta: '#808db4',
    accent: '#50fa7b',
    placeholder: '#343746',
    placeholderInk: '#585961',
    progressTrack: '#52535c',
    divider: '#393a45',
    titleHover: '#50fa7b',
  },
  tokyonight: {
    bg: '#1a1b26',
    border: '#2c2e3d',
    title: '#c0caf5',
    artist: '#7aa2f7',
    /** Lifted off #565f89 for the same reason as Dracula's. */
    meta: '#767fa9',
    accent: '#9ece6a',
    placeholder: '#272937',
    placeholderInk: '#404356',
    progressTrack: '#3b3e4f',
    divider: '#272937',
    titleHover: '#9ece6a',
  },
} as const satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export const DEFAULT_THEME: ThemeName = 'dark';

export function isThemeName(value: string): value is ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}

/**
 * Caller-supplied colors, each null when not given.
 *
 * These are roles, not elements: `meta` is the timestamp, the duration and the
 * footer together. Everything else in `Theme` is
 * derived, because it is a relationship rather than a choice - mixing `title`
 * toward `bg` reproduces the presets' own dividers and placeholders closely.
 *
 * `artist` and `meta` look mergeable and are not: nord and catppuccin pair a
 * hued artist line with a neutral grey timestamp, and deriving one from the
 * other turns that grey blue or purple.
 */
export interface ThemeOverrides {
  bg?: string | null;
  title?: string | null;
  /** The artist line. */
  artist?: string | null;
  /** Timestamps, durations and the footer. */
  meta?: string | null;
  accent?: string | null;
}

/** WCAG AA for body text; the card's smaller type is where it matters. */
const MIN_CONTRAST = 4.5;

/** Ratios measured from the presets - see `color.ts` and the tests. */
const DERIVED = {
  artist: 0.31,
  border: 0.89,
  meta: 0.48,
  divider: 0.92,
  placeholder: 0.92,
  placeholderInk: 0.77,
  progressTrack: 0.8,
} as const;

function hasOverride(overrides: ThemeOverrides | undefined): overrides is ThemeOverrides {
  return Boolean(overrides && Object.values(overrides).some(Boolean));
}

export function resolveTheme(name: string | null | undefined, overrides?: ThemeOverrides): Theme {
  const base: Theme = name && isThemeName(name) ? THEMES[name] : THEMES[DEFAULT_THEME];

  // The common path. Returning the preset object itself - rather than a copy
  // built from the same values - keeps existing cards provably unchanged.
  if (!hasOverride(overrides)) return base;

  const bg = overrides.bg ?? base.bg;

  // A background alone can make a theme unreadable - `?bg_color=ffffff` on the
  // dark theme painted #e9eef5 onto white. Borrow the inks from whichever
  // built-in palette suits it, which keeps the result looking designed in a way
  // that computing a contrasting grey does not.
  const contrast = contrastRatio(bg, base.title);
  const ink: Theme =
    contrast !== null && contrast < MIN_CONTRAST ? (isLight(bg) ? THEMES.light : THEMES.dark) : base;

  const title = overrides.title ?? ink.title;
  const accent = overrides.accent ?? ink.accent;

  // Supporting colors are only re-derived when the pair they hang off has
  // moved, and only when there is a background to fade toward: `transparent`
  // has `bg: 'none'`, and mixing toward nothing collapses them onto the title.
  const mixable = parseRgba(bg) !== null;
  const derive = mixable && (title !== ink.title || bg !== ink.bg);
  const from = (ratio: number, fallback: string): string =>
    derive ? mix(title, bg, ratio) : fallback;

  return {
    bg,
    title,
    artist: overrides.artist ?? from(DERIVED.artist, ink.artist),
    accent,
    meta: overrides.meta ?? from(DERIVED.meta, ink.meta),
    border: from(DERIVED.border, ink.border),
    divider: from(DERIVED.divider, ink.divider),
    placeholder: from(DERIVED.placeholder, ink.placeholder),
    placeholderInk: from(DERIVED.placeholderInk, ink.placeholderInk),
    progressTrack: from(DERIVED.progressTrack, ink.progressTrack),
    // The presets mostly set these equal already; where they differ it is a
    // nudge that only makes sense against that palette's own accent.
    titleHover: overrides.accent ?? ink.titleHover,
  };
}
