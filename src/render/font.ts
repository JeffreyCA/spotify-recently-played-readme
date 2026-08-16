/**
 * The system font stack.
 *
 * An SVG rendered inside an <img> cannot load external fonts, so the card
 * relies on whatever the reader already has. Rendering differs slightly per
 * platform; that is the accepted tradeoff for not embedding a base64 font,
 * which would add ~50-100 KB to every single response.
 *
 * `measure.ts` holds advance widths measured from this stack, so the two must
 * stay in step.
 */
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
