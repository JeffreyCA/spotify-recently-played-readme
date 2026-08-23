/**
 * SVG has no `text-overflow: ellipsis`, and an SVG rendered inside an <img>
 * cannot measure text at runtime, so width has to be estimated server-side.
 *
 * The table is real advance widths for printable ASCII, as a fraction of font
 * size, measured from the resolved font stack with Canvas TextMetrics at
 * 1000px and averaged over regular and semibold.
 *
 * Per character rather than per category, because categories are not tight
 * enough for anything that has to butt up against text: capitals alone span
 * 0.38 ("J") to 0.95 ("W"), so a category average leaves a badge placed after
 * a title either floating or overlapping depending on the title.
 *
 * Platforms resolving a different family will be a little off, so callers
 * should still leave slack rather than treat this as exact.
 */
// prettier-ignore
const ASCII_WIDTHS = [
  0.27, 0.29, 0.41, 0.59, 0.55, 0.83, 0.76, 0.24, // sp ! " # $ % & '
  0.32, 0.32, 0.43, 0.69, 0.23, 0.40, 0.23, 0.40, // ( ) * + , - . /
  0.55, 0.47, 0.55, 0.55, 0.56, 0.55, 0.55, 0.54, // 0 1 2 3 4 5 6 7
  0.55, 0.55, 0.23, 0.23, 0.69, 0.69, 0.69, 0.45, // 8 9 : ; < = > ?
  0.95, 0.66, 0.59, 0.62, 0.71, 0.51, 0.50, 0.69, // @ A B C D E F G
  0.72, 0.28, 0.38, 0.60, 0.48, 0.91, 0.76, 0.75, // H I J K L M N O
  0.57, 0.75, 0.61, 0.54, 0.54, 0.70, 0.63, 0.95, // P Q R S T U V W
  0.60, 0.56, 0.58, 0.32, 0.39, 0.32, 0.69, 0.42, // X Y Z [ \ ] ^ _
  0.28, 0.52, 0.60, 0.47, 0.60, 0.53, 0.33, 0.60, // ` a b c d e f g
  0.57, 0.25, 0.25, 0.51, 0.25, 0.87, 0.57, 0.59, // h i j k l m n o
  0.60, 0.60, 0.36, 0.43, 0.35, 0.57, 0.49, 0.74, // p q r s t u v w
  0.48, 0.50, 0.46, 0.32, 0.26, 0.32, 0.69,       // x y z { | } ~
];

const FIRST_CODE = 32;
const LAST_CODE = 126;

/** Non-ASCII characters common enough in track titles to be worth pinning. */
const EXTRA_WIDTHS: Record<string, number> = {
  '\u2018': 0.24,
  '\u2019': 0.24,
  '\u201c': 0.4,
  '\u201d': 0.4,
  '\u2013': 0.5,
  '\u2014': 1.0,
  '\u2026': 0.77,
  // Spotify writes feature credits with a real bullet more often than not.
  '\u2022': 0.35,
};

/** Advance width of a character as a fraction of font size. */
function charRatio(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;

  if (code >= FIRST_CODE && code <= LAST_CODE) {
    return ASCII_WIDTHS[code - FIRST_CODE]!;
  }

  const extra = EXTRA_WIDTHS[ch];
  if (extra !== undefined) return extra;

  // CJK, Hangul and full-width forms are roughly square.
  if (code >= 0x1100 && code <= 0x11ff) return 1.0;
  if (code >= 0x2e80 && code <= 0xa4cf) return 1.0;
  if (code >= 0xac00 && code <= 0xd7a3) return 1.0;
  if (code >= 0xf900 && code <= 0xfaff) return 1.0;
  if (code >= 0xff00 && code <= 0xff60) return 1.0;
  // Emoji and other astral-plane symbols.
  if (code > 0xffff) return 1.15;

  return 0.54;
}

/**
 * The table above is averaged over regular and semibold, so it is exact for
 * neither: bolder text is wider at the same size. Measured across printable
 * ASCII, semibold runs ~1.6% wider than that average and regular ~1.6%
 * narrower, and weight 500 lands on it by construction.
 *
 * The error is proportional to length, so it stays invisible on short strings
 * and matters on long ones.
 */
const REGULAR_SCALE = 0.9843;
const SEMIBOLD_SCALE = 1.0157;

/**
 * San Francisco renders representative title and metadata runs 5-7% wider
 * than the font used to build the table. Natural text reserves this extra
 * room instead of being condensed with SVG `textLength`.
 */
const SYSTEM_FONT_WIDTH_ALLOWANCE = 1.08;

function weightScale(weight: number): number {
  const t = Math.min(1, Math.max(0, (weight - 400) / 200));
  return REGULAR_SCALE + (SEMIBOLD_SCALE - REGULAR_SCALE) * t;
}

/**
 * `weight` must match what the text is actually drawn with, or the estimate
 * drifts in the direction of the mismatch.
 */
export function estimateWidth(text: string, fontSize: number, weight = 400): number {
  const scale = weightScale(weight) * fontSize;
  let total = 0;
  for (const ch of text) total += charRatio(ch) * scale;
  return total;
}

/** Conservative width for naturally rendered text across the system stack. */
export function estimateLayoutWidth(text: string, fontSize: number, weight = 400): number {
  return estimateWidth(text, fontSize, weight) * SYSTEM_FONT_WIDTH_ALLOWANCE;
}

/**
 * Truncates to fit `maxWidth`, appending a single-character ellipsis.
 * Iterates by code point so surrogate pairs and emoji are never split in half
 * (a split surrogate produces an invalid XML character and a broken image).
 */
export function truncateToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  weight = 400,
): string {
  if (maxWidth <= 0) return '';
  if (estimateWidth(text, fontSize, weight) <= maxWidth) return text;

  const ellipsis = '\u2026';
  const scale = weightScale(weight) * fontSize;
  const budget = maxWidth - charRatio(ellipsis) * scale;
  if (budget <= 0) return ellipsis;

  let used = 0;
  let out = '';
  for (const ch of text) {
    const w = charRatio(ch) * scale;
    if (used + w > budget) break;
    used += w;
    out += ch;
  }
  return out.trimEnd() + ellipsis;
}
