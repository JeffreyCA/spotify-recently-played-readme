/**
 * Inline vector icons.
 *
 * Everything here is drawn as SVG paths rather than embedded raster images.
 * Inside an <img>-rendered SVG we cannot reference external files, so the only
 * alternative would be base64 rasters - which are far larger, blur on HiDPI
 * displays, and cannot be recolored per theme. Paths solve all three.
 */

/**
 * The Spotify circle mark: the outer disc and the three sound waves.
 *
 * This is the leading run of subpaths from the full wordmark below, which is
 * why it can be sliced off by prefix - the wordmark's glyphs begin at the
 * `m94.56 3.072` subpath that follows it.
 */
const MARK_PATH =
  'm83.996 0.277c-46.249 0-83.743 37.493-83.743 83.742 0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.745-83.738l0.001-0.004zm38.404 120.78c-1.5 2.46-4.72 3.24-7.18 1.73-19.662-12.01-44.414-14.73-73.564-8.07-2.809 0.64-5.609-1.12-6.249-3.93-0.643-2.81 1.11-5.61 3.926-6.25 31.9-7.288 59.263-4.15 81.337 9.34 2.46 1.51 3.24 4.72 1.73 7.18zm10.25-22.802c-1.89 3.072-5.91 4.042-8.98 2.152-22.51-13.836-56.823-17.843-83.448-9.761-3.453 1.043-7.1-0.903-8.148-4.35-1.04-3.453 0.907-7.093 4.354-8.143 30.413-9.228 68.222-4.758 94.072 11.127 3.07 1.89 4.04 5.91 2.15 8.976v-0.001zm0.88-23.744c-26.99-16.031-71.52-17.505-97.289-9.684-4.138 1.255-8.514-1.081-9.768-5.219-1.254-4.14 1.08-8.513 5.221-9.771 29.581-8.98 78.756-7.245 109.83 11.202 3.73 2.209 4.95 7.016 2.74 10.733-2.2 3.722-7.02 4.949-10.73 2.739z';

/** The mark followed by the "Spotify" wordmark. Intrinsic viewBox 559 x 168. */
const LOGO_PATH =
  MARK_PATH +
  'm94.56 3.072c-14.46-3.448-17.03-5.868-17.03-10.953 0-4.804 4.52-8.037 11.25-8.037 6.52 0 12.98 2.455 19.76 7.509 0.2 0.153 0.46 0.214 0.71 0.174 0.26-0.038 0.48-0.177 0.63-0.386l7.06-9.952c0.29-0.41 0.21-0.975-0.18-1.288-8.07-6.473-17.15-9.62-27.77-9.62-15.61 0-26.52 9.369-26.52 22.774 0 14.375 9.41 19.465 25.67 23.394 13.83 3.187 16.17 5.857 16.17 10.629 0 5.29-4.72 8.58-12.32 8.58-8.44 0-15.33-2.85-23.03-9.51-0.19-0.17-0.45-0.24-0.69-0.23-0.26 0.02-0.49 0.14-0.65 0.33l-7.92 9.42c-0.33 0.4-0.29 0.98 0.09 1.32 8.96 8 19.98 12.22 31.88 12.22 16.82 0 27.69-9.19 27.69-23.42 0.03-12.007-7.16-18.657-24.77-22.941l-0.03-0.013zm62.86-14.26c-7.29 0-13.27 2.872-18.21 8.757v-6.624c0-0.523-0.42-0.949-0.94-0.949h-12.95c-0.52 0-0.94 0.426-0.94 0.949v73.601c0 0.52 0.42 0.95 0.94 0.95h12.95c0.52 0 0.94-0.43 0.94-0.95v-23.23c4.94 5.53 10.92 8.24 18.21 8.24 13.55 0 27.27-10.43 27.27-30.369 0.02-19.943-13.7-30.376-27.26-30.376l-0.01 0.001zm12.21 30.375c0 10.149-6.25 17.239-15.21 17.239-8.85 0-15.53-7.41-15.53-17.239 0-9.83 6.68-17.238 15.53-17.238 8.81-0.001 15.21 7.247 15.21 17.237v0.001zm50.21-30.375c-17.45 0-31.12 13.436-31.12 30.592 0 16.972 13.58 30.262 30.91 30.262 17.51 0 31.22-13.39 31.22-30.479 0-17.031-13.62-30.373-31.01-30.373v-0.002zm0 47.714c-9.28 0-16.28-7.46-16.28-17.344 0-9.929 6.76-17.134 16.07-17.134 9.34 0 16.38 7.457 16.38 17.351 0 9.927-6.8 17.127-16.17 17.127zm68.27-46.53h-14.25v-14.566c0-0.522-0.42-0.948-0.94-0.948h-12.95c-0.52 0-0.95 0.426-0.95 0.948v14.566h-6.22c-0.52 0-0.94 0.426-0.94 0.949v11.127c0 0.522 0.42 0.949 0.94 0.949h6.22v28.795c0 11.63 5.79 17.53 17.22 17.53 4.64 0 8.49-0.96 12.12-3.02 0.3-0.16 0.48-0.48 0.48-0.82v-10.6c0-0.32-0.17-0.63-0.45-0.8-0.28-0.18-0.63-0.19-0.92-0.04-2.49 1.25-4.9 1.83-7.6 1.83-4.15 0-6.01-1.89-6.01-6.11v-26.76h14.25c0.52 0 0.94-0.426 0.94-0.949v-11.126c0.02-0.523-0.4-0.949-0.93-0.949l-0.01-0.006zm49.64 0.057v-1.789c0-5.263 2.02-7.61 6.54-7.61 2.7 0 4.87 0.536 7.3 1.346 0.3 0.094 0.61 0.047 0.85-0.132 0.25-0.179 0.39-0.466 0.39-0.77v-10.91c0-0.417-0.26-0.786-0.67-0.909-2.56-0.763-5.84-1.546-10.76-1.546-11.95 0-18.28 6.734-18.28 19.467v2.74h-6.22c-0.52 0-0.95 0.426-0.95 0.948v11.184c0 0.522 0.43 0.949 0.95 0.949h6.22v44.405c0 0.53 0.43 0.95 0.95 0.95h12.94c0.53 0 0.95-0.42 0.95-0.95v-44.402h12.09l18.52 44.402c-2.1 4.66-4.17 5.59-6.99 5.59-2.28 0-4.69-0.68-7.14-2.03-0.23-0.12-0.51-0.14-0.75-0.07-0.25 0.09-0.46 0.27-0.56 0.51l-4.39 9.63c-0.21 0.46-0.03 0.99 0.41 1.23 4.58 2.48 8.71 3.54 13.82 3.54 9.56 0 14.85-4.46 19.5-16.44l22.46-58.037c0.12-0.292 0.08-0.622-0.1-0.881-0.17-0.257-0.46-0.412-0.77-0.412h-13.48c-0.41 0-0.77 0.257-0.9 0.636l-13.81 39.434-15.12-39.46c-0.14-0.367-0.49-0.61-0.88-0.61h-22.12v-0.003zm-28.78-0.057h-12.95c-0.52 0-0.95 0.426-0.95 0.949v56.481c0 0.53 0.43 0.95 0.95 0.95h12.95c0.52 0 0.95-0.42 0.95-0.95v-56.477c0-0.523-0.42-0.949-0.95-0.949v-0.004zm-6.4-25.719c-5.13 0-9.29 4.152-9.29 9.281 0 5.132 4.16 9.289 9.29 9.289s9.28-4.157 9.28-9.289c0-5.128-4.16-9.281-9.28-9.281zm113.42 43.88c-5.12 0-9.11-4.115-9.11-9.112s4.04-9.159 9.16-9.159 9.11 4.114 9.11 9.107c0 4.997-4.04 9.164-9.16 9.164zm0.05-17.365c-4.67 0-8.2 3.71-8.2 8.253 0 4.541 3.51 8.201 8.15 8.201 4.67 0 8.2-3.707 8.2-8.253 0-4.541-3.51-8.201-8.15-8.201zm2.02 9.138l2.58 3.608h-2.18l-2.32-3.31h-1.99v3.31h-1.82v-9.564h4.26c2.23 0 3.69 1.137 3.69 3.051 0.01 1.568-0.9 2.526-2.21 2.905h-0.01zm-1.54-4.315h-2.37v3.025h2.37c1.18 0 1.89-0.579 1.89-1.514 0-0.984-0.71-1.511-1.89-1.511z';

const LOGO_W = 559;
const LOGO_H = 168;

/*
 * Measured from the path itself rather than taken from the viewBox, because
 * the two are not the same thing: the circle mark fills the box, while the
 * "Spotify" glyphs occupy a band in the lower middle of it.
 *
 *   whole ink      0.28 .. 167.76   (the circle, essentially the full box)
 *   wordmark ink  38.79 .. 140.34   (i-dot down to the y descender)
 *   baseline     122.89             (flat-bottomed "i" stem)
 *   round letters overshoot to 124.18, which is optical correction in the
 *   original artwork and must not be mistaken for the baseline
 *   cap top       45.03             (the "S")
 */
const LOGO_BASELINE_RATIO = 122.89 / LOGO_H;
const LOGO_INK_TOP_RATIO = 0.28 / LOGO_H;
const LOGO_INK_BOTTOM_RATIO = 167.76 / LOGO_H;

/**
 * Wordmark cap height as a fraction of the box.
 *
 * This is what makes the logo size a derivation rather than a taste call:
 * setting `LOGO_H` so this lands on the header title's cap height puts
 * "Spotify" and "Recently Played" at the same visual size.
 */
const LOGO_CAP_RATIO = (122.89 - 45.03) / LOGO_H;

/** How far the logo's ink reaches above the wordmark's baseline. */
export function logoAscent(height: number): number {
  return (LOGO_BASELINE_RATIO - LOGO_INK_TOP_RATIO) * height;
}

/** How far it reaches below - the bottom of the circle, not the descenders. */
export function logoDescent(height: number): number {
  return (LOGO_INK_BOTTOM_RATIO - LOGO_BASELINE_RATIO) * height;
}

/** The box height whose wordmark caps match text of `capHeight`. */
export function logoHeightForCap(capHeight: number): number {
  return capHeight / LOGO_CAP_RATIO;
}/**
 * Spotify's brand green. The logo is a trademark, so it defaults to this in
 * every theme rather than taking the theme accent - a purple Spotify mark is
 * no longer their mark. `logo_color` can override it deliberately.
 */
export const SPOTIFY_GREEN = '#1db954';

export function logoWidth(height: number): number {
  return (LOGO_W / LOGO_H) * height;
}

/**
 * Full wordmark - mark plus "Spotify" - sitting on `baseline`.
 *
 * Baseline rather than centre, so the wordmark lines up with adjacent text the
 * same way two pieces of text line up with each other. The circle then
 * overhangs above and below, which is correct: it is a logo beside a title, not
 * a second line of type.
 *
 * A transparent rect covers the whole box, so the gaps inside and between the
 * glyphs are clickable too - without it only the ink responds, and a wordmark
 * is mostly not ink.
 */
export function spotifyLogo(
  x: number,
  baseline: number,
  height: number,
  color: string,
  className?: string,
): string {
  const top = baseline - LOGO_BASELINE_RATIO * height;
  const scale = height / LOGO_H;
  const cls = className ? ` class="${className}"` : '';
  return (
    `<g${cls} transform="translate(${round(x)},${round(top)}) scale(${scale.toFixed(5)})" fill="${color}">` +
    `<rect x="0" y="0" width="${LOGO_W}" height="${LOGO_H}" fill="transparent"/>` +
    `<path d="${LOGO_PATH}"/>` +
    `</g>`
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Disc tile shown when a track has no cover art. Drawn in theme colors so it
 * sits in the card instead of punching a bright grey hole in it.
 */
export function discPlaceholder(
  x: number,
  y: number,
  size: number,
  bg: string,
  ink: string,
  radius = 4,
): string {
  const cx = x + size / 2;
  const cy = y + size / 2;
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${round(size * 0.32)}" fill="${ink}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${round(size * 0.135)}" fill="none" stroke="${bg}" stroke-width="${round(size * 0.07)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${round(size * 0.035)}" fill="${bg}"/>`
  );
}

/**
 * How far the placeholder artwork's ink centre sits below the middle of its own
 * 24x24 grid. Measured from the rendered bounding box, not eyeballed.
 */
const PLACEHOLDER_INK_LOW = 0.85;

/**
 * Headphones-wearing silhouette used when an account has no profile picture.
 * Drawn on a 24x24 grid and scaled, so it stays sharp at any avatar size.
 */
export function avatarPlaceholder(
  cx: number,
  cy: number,
  size: number,
  bg: string,
  ink: string,
): string {
  const scale = size / 24;
  const x = cx - size / 2;
  // The artwork is not centred in its own grid: its ink runs 4.2 to 21.5, so it
  // sits 0.85 low against the 24-grid's middle. Left alone the mark looks like
  // it has slipped down inside the circle.
  const y = cy - size / 2 - PLACEHOLDER_INK_LOW * scale;
  return (
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(size / 2)}" fill="${bg}"/>` +
    `<g transform="translate(${round(x)},${round(y)}) scale(${scale.toFixed(4)})" fill="${ink}">` +
    `<path d="M12,4.2c-4,0-7.2,3-7.2,6.7v2.4h1.9v-2.4C6.7,8,9,5.9,12,5.9s5.3,2.1,5.3,5v2.4h1.9v-2.4C19.2,7.2,16,4.2,12,4.2z"/>` +
    `<rect x="3.1" y="10.6" width="3.4" height="5.2" rx="1.7"/>` +
    `<rect x="17.5" y="10.6" width="3.4" height="5.2" rx="1.7"/>` +
    `<circle cx="12" cy="12.4" r="3.6"/>` +
    `<path d="M12,16.6c-3.7,0-6.7,1.6-6.7,3.6v1.3h13.4v-1.3C18.7,18.2,15.7,16.6,12,16.6z"/>` +
    `</g>`
  );
}

/**
 * The explicit-content marker: a rounded square with an "E" knocked out of it,
 * as Spotify's own clients draw it.
 *
 * The glyph is a path rather than a `<text>` element so it cannot be reflowed
 * by whatever font the reader happens to have - at this size a substituted
 * font turns the badge into a smudge.
 */
export function explicitBadge(x: number, y: number, size: number, color: string): string {
  const scale = size / 16;
  return (
    `<g transform="translate(${round(x)},${round(y)}) scale(${scale.toFixed(4)})" fill="${color}">` +
    `<path fill-rule="evenodd" d="M2.4 1h11.2A1.4 1.4 0 0 1 15 2.4v11.2a1.4 1.4 0 0 1-1.4 1.4H2.4A1.4 1.4 0 0 1 1 13.6V2.4A1.4 1.4 0 0 1 2.4 1zm3 3.1v7.8h5.3v-1.7H7.3V8.9h3.4V7.2H7.3V5.8h3.4V4.1H5.4z"/>` +
    `</g>`
  );
}
