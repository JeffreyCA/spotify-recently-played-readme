/**
 * Color maths for deriving one palette color from another.
 *
 * Mixing is in sRGB rather than a perceptual space, because that is how the
 * presets were built: solving for the mix ratio between `title` and `bg`
 * reproduces their supporting colors closely.
 */

interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0-1. Carried through mixes so a translucent input stays translucent. */
  a: number;
}

/**
 * Parses the output of `parseHexColor` - always `#rrggbb` or `#rrggbbaa`,
 * since that function expands the short forms. Anything else returns null,
 * including the `none` used by the transparent theme's background.
 */
export function parseRgba(color: string): Rgba | null {
  if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return null;
  const hex = color.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

function formatRgba({ r, g, b, a }: Rgba): string {
  const rgb = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a >= 1 ? rgb : `${rgb}${toHex(a * 255)}`;
}

/**
 * Moves `from` a fraction `t` of the way toward `to`, where 0 keeps `from`.
 *
 * Alpha comes from `from`, since `to` is only a reference point to fade toward:
 * inheriting the background's transparency would make the text vanish. Returns
 * `from` unchanged when either color is unparseable, so the transparent theme's
 * `none` yields a usable value rather than a broken attribute.
 */
export function mix(from: string, to: string, t: number): string {
  const a = parseRgba(from);
  const b = parseRgba(to);
  if (!a || !b) return from;

  const clamped = Math.max(0, Math.min(1, t));
  return formatRgba({
    r: a.r + (b.r - a.r) * clamped,
    g: a.g + (b.g - a.g) * clamped,
    b: a.b + (b.b - a.b) * clamped,
    a: a.a,
  });
}

/** WCAG relative luminance. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseRgba(color);
  if (!rgb) return null;

  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * WCAG contrast ratio, 1 (identical) to 21 (black on white). Null when either
 * color is unparseable, so callers can tell "no opinion" from "poor contrast".
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;

  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when `color` is light enough that dark ink reads better on it. */
export function isLight(color: string): boolean {
  const luminance = relativeLuminance(color);
  return luminance !== null && luminance > 0.5;
}
