import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/render/color';
import { resolveTheme, THEME_NAMES, THEMES } from '../src/render/themes';

/**
 * The color maths is the exception to "verify visual work by looking at it": a
 * wrong mix ratio or a dropped contrast check produces a card that renders
 * perfectly and just looks wrong, with nothing to catch it.
 */

describe('resolveTheme', () => {
  it('returns the preset itself when nothing is overridden', () => {
    // Identity, not equality: proves existing cards cannot shift by a rounding
    // error introduced somewhere in the derivation code.
    for (const name of THEME_NAMES) {
      expect(resolveTheme(name)).toBe(THEMES[name]);
      expect(resolveTheme(name, { bg: null, title: null })).toBe(THEMES[name]);
    }
    expect(resolveTheme('nonsense')).toBe(THEMES.dark);
  });

  it('rescues a background the theme cannot be read on', () => {
    // The bug this feature started from: white background, near-white text.
    const resolved = resolveTheme('dark', { bg: '#ffffff' });

    expect(resolved.bg).toBe('#ffffff');
    expect(contrastRatio(resolved.bg, resolved.title)!).toBeGreaterThan(4.5);
    // Borrowed from the palette built for light backgrounds rather than an
    // invented grey.
    expect(resolved.title).toBe(THEMES.light.title);
    // But left alone when the new background still reads.
    expect(resolveTheme('dark', { bg: '#101010' }).title).toBe(THEMES.dark.title);
  });

  it('only moves what an override names', () => {
    // nord pairs a hued artist line with a neutral grey timestamp, so deriving
    // either from the other turns that grey blue.
    const artist = resolveTheme('nord', { artist: '#ff0000' });
    expect(artist.artist).toBe('#ff0000');
    expect(artist.meta).toBe(THEMES.nord.meta);

    const accent = resolveTheme('nord', { accent: '#ff0000' });
    expect(accent.accent).toBe('#ff0000');
    expect(accent.artist).toBe(THEMES.nord.artist);
    expect(accent.divider).toBe(THEMES.nord.divider);
  });

  it('never derives against a background it cannot mix toward', () => {
    // `transparent` has bg: 'none'. Mixing toward it would collapse every
    // supporting color onto the title.
    const resolved = resolveTheme('transparent', { title: '#ff0000' });

    expect(resolved.bg).toBe('none');
    expect(resolved.divider).toBe(THEMES.transparent.divider);
  });

  it('always produces colors that are safe in an SVG attribute', () => {
    const resolved = resolveTheme('dark', {
      bg: '#ffffff',
      title: '#123456',
      artist: '#abcdef',
      meta: '#fedcba',
      accent: '#00000080',
    });

    for (const value of Object.values(resolved)) {
      expect(value).toMatch(/^(#[0-9a-f]{6}([0-9a-f]{2})?|none)$/);
    }
  });
});

describe('preset palettes', () => {
  it('keeps every preset readable against its own background', () => {
    // A preset failing here is a bug nobody would notice from a screenshot on
    // their own monitor - and it is what caught brand green sitting at 2.3:1
    // on the light theme's white.
    for (const name of THEME_NAMES) {
      const theme = THEMES[name];
      if (theme.bg === 'none') continue;

      expect(contrastRatio(theme.bg, theme.title)!, `${name} title`).toBeGreaterThan(4.5);
      expect(contrastRatio(theme.bg, theme.artist)!, `${name} artist`).toBeGreaterThan(3);
      expect(contrastRatio(theme.bg, theme.meta)!, `${name} meta`).toBeGreaterThan(3);
      // The accent carries the "Listening now" label, so it has to be legible
      // rather than merely visible.
      expect(contrastRatio(theme.bg, theme.accent)!, `${name} accent`).toBeGreaterThan(3);
    }
  });
});
