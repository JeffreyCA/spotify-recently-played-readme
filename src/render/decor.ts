/**
 * Decorative graphics for the card. Distinct from `icons.ts`, which holds
 * fixed artwork: everything here is generated from parameters at render time
 * and sized to the space it is given.
 */

/**
 * Independent strands rather than one band: each has its own frequency, phase
 * and amplitude, so they cross and separate across the width instead of
 * running parallel. Drift shifts a strand off the centre line so the weave
 * fills the band rather than pinching in the middle.
 */
const WAVE_STRANDS = [
  { freq: 1.7, phase: 4.1, amp: 0.95, drift: 0.0, opacity: 0.5 },
  { freq: 2.1, phase: 0.4, amp: 0.8, drift: -0.1, opacity: 0.42 },
  { freq: 2.9, phase: 2.3, amp: 0.6, drift: 0.12, opacity: 0.34 },
  { freq: 3.4, phase: 1.1, amp: 0.45, drift: -0.05, opacity: 0.26 },
  { freq: 2.4, phase: 5.3, amp: 0.7, drift: 0.16, opacity: 0.2 },
];

/** Below this a dot is invisible anyway, so it is not worth the bytes. */
const MIN_DOT_OPACITY = 0.08;

/**
 * A quiet dot-field wave for the card footer: theme ink at low opacity,
 * strands that fade out at both ends, and no hard edges anywhere.
 */
export function waveDecor(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): string {
  const cols = Math.max(28, Math.min(90, Math.round(width / 6.5)));
  const midY = y + height / 2;
  const amp = height * 0.3;

  // Keyed by quantised opacity, so dots can share a path instead of each
  // carrying its own attribute.
  const buckets = new Map<string, string[]>();

  for (const strand of WAVE_STRANDS) {
    for (let i = 0; i < cols; i++) {
      const t = cols === 1 ? 0.5 : i / (cols - 1);
      const cx = x + t * width;
      // Fade each strand out at both ends so the weave dissolves into the card
      // rather than being cut off by its edge.
      const envelope = Math.sin(Math.PI * t) ** 0.55;
      const cy =
        midY +
        strand.drift * height +
        Math.sin(t * Math.PI * 2 * strand.freq + strand.phase) * strand.amp * amp * envelope;

      const opacity = strand.opacity * envelope;
      if (opacity < MIN_DOT_OPACITY) continue;

      const key = (Math.round(opacity * 10) / 10).toFixed(1);
      // A dot as a near-zero-length subpath with a round cap: about half the
      // bytes of a <circle>, and several hundred of them ship with this footer.
      const dot = `M${round1(cx)} ${round1(cy)}h.01`;
      const list = buckets.get(key);
      if (list) list.push(dot);
      else buckets.set(key, [dot]);
    }
  }

  const groups = [...buckets]
    .map(([opacity, dots]) => `<path opacity="${opacity}" d="${dots.join('')}"/>`)
    .join('');

  return `<g stroke="${color}" stroke-width="1.7" stroke-linecap="round" fill="none">${groups}</g>`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
