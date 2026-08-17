import { escapeXml } from './escape';
import { FONT_STACK } from './font';
import { truncateToWidth } from './measure';
import { resolveTheme } from './themes';

export interface ErrorCardInput {
  message: string;
  hint?: string;
  /** Makes `hint` a link. Only resolves where the SVG is interactive - see below. */
  hintHref?: string;
  theme?: string;
  width?: number;
  radius?: number;
}

/**
 * Errors must still be a valid SVG served with HTTP 200.
 *
 * Camo's feature list claims it forwards images "regardless of HTTP status
 * code", but GitHub's deployed proxy is not the same code as the public README,
 * and a non-200 risks rendering as a generic broken-image icon with no
 * explanation. Showing the user *why* their widget is blank is far more useful -
 * and this card carries the "reconnect your Spotify account" message, which is
 * the one error a reader can actually do something about.
 */
export function renderErrorCard({
  message,
  hint,
  hintHref,
  theme: themeName,
  width = 400,
  radius = 10,
}: ErrorCardInput): string {
  const theme = resolveTheme(themeName);
  const height = hint ? 76 : 58;
  const maxTextWidth = width - 32 - 26;

  const title = truncateToWidth(message, 13, maxTextWidth, 600);
  const sub = hint ? truncateToWidth(hint, 11, maxTextWidth) : '';

  const background =
    theme.bg === 'none'
      ? ''
      : `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="${theme.bg}" stroke="${theme.border}"/>`;

  const icon =
    `<circle cx="28" cy="${hint ? 32 : 29}" r="8" fill="none" stroke="${theme.accent}" stroke-width="1.5"/>` +
    `<line x1="28" y1="${hint ? 28 : 25}" x2="28" y2="${hint ? 33 : 30}" stroke="${theme.accent}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<circle cx="28" cy="${hint ? 36 : 33}" r="1" fill="${theme.accent}"/>`;

  const titleY = hint ? 30 : 33;
  // Underlined and accent-coloured when it links, so it reads as actionable
  // rather than more explanation.
  //
  // The link only resolves where the SVG is interactive - a direct view,
  // `<object>`, or inline - not through GitHub's inert `<img>` embed, where
  // it's just text to copy. Spelled out in full for that reason, rather than
  // hidden behind a word like "here".
  const hintText = hint
    ? `<text x="46" y="48" font-family="${FONT_STACK}" font-size="11"` +
      ` fill="${hintHref ? theme.accent : theme.meta}"` +
      `${hintHref ? ' text-decoration="underline"' : ''}>${escapeXml(sub)}</text>`
    : '';

  const body =
    `<text x="46" y="${titleY}" font-family="${FONT_STACK}" font-size="13" font-weight="600" fill="${theme.title}">${escapeXml(title)}</text>` +
    (hintHref
      ? `<a href="${escapeXml(hintHref)}" target="_blank" rel="noopener noreferrer">${hintText}</a>`
      : hintText);

  // Spotify is named even on the failure card: the Developer Terms ask for
  // attribution wherever their content is presented, and a card that failed is
  // still a card the reader thinks came from Spotify.
  const alt = `Spotify: ${hint ? `${message}. ${hint}` : message}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(alt)}">` +
    `<title>${escapeXml(alt)}</title>` +
    background +
    icon +
    body +
    `</svg>`
  );
}
