/**
 * The system font stack.
 *
 * An SVG rendered inside an <img> cannot load external fonts, so the card
 * relies on whatever the reader already has. Letterforms therefore differ
 * slightly per platform. Width-sensitive text is constrained when a non-text
 * sibling depends on the server-side estimate.
 *
 * `measure.ts` holds advance widths measured from this stack, so the two must
 * stay in step.
 */
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
