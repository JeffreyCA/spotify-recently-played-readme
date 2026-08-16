/**
 * XML escaping is the single most important correctness concern in this project.
 * Track and artist names routinely contain &, <, >, quotes and control characters.
 * One unescaped ampersand produces a malformed SVG, which GitHub renders as a
 * broken-image icon with no error message at all.
 *
 * Every piece of Spotify-derived text must pass through `escapeXml` before it is
 * interpolated into the SVG. There are no exceptions.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Control characters that are illegal in XML 1.0 even when escaped. */
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(input: string): string {
  return input.replace(ILLEGAL_XML_CHARS, '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * Escapes a string for use inside an SVG `<style>` block.
 *
 * Only for style content, which the XML parser does not escape, so a stray
 * `</style>` would break out of it. Attributes do not need this: every color
 * reaching one is either a theme preset or `parseHexColor` output, and that
 * allowlist - not this function - is the boundary. Sprinkling it on attributes
 * as well suggested a guarantee that was never enforced.
 */
export function escapeCss(input: string): string {
  return input.replace(/[<>"'\\]/g, '');
}
