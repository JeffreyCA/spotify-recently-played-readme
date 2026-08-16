import { describe, expect, it } from 'vitest';
import { MAX_AGE_SECONDS, translate } from '../api/_translate';

function run(query: string): URLSearchParams {
  return translate(new URLSearchParams(query)).params;
}

describe('translate', () => {
  it('forwards the parameters the old endpoint accepted', () => {
    const out = run('user=jeffreyca16&count=3&width=600&unique=true');

    expect(out.get('user')).toBe('jeffreyca16');
    expect(out.get('count')).toBe('3');
    expect(out.get('width')).toBe('600');
    expect(out.get('unique')).toBe('true');
  });

  it('omits what was not asked for, so the Worker applies its own defaults', () => {
    const out = run('user=jeffreyca16');

    expect(out.has('count')).toBe(false);
    expect(out.has('width')).toBe(false);
    expect(out.has('unique')).toBe(false);
  });

  it('never pins old embeds to the legacy theme', () => {
    expect(run('user=a').has('theme')).toBe(false);
  });

  it('forwards a theme when one is given', () => {
    expect(run('user=a&theme=nord').get('theme')).toBe('nord');
  });

  it('turns the profile off, since the old card never showed one', () => {
    expect(run('user=a').get('profile')).toBe('off');
  });

  it('lets a caller opt the profile back in', () => {
    expect(run('user=a&profile=header').get('profile')).toBe('header');
  });

  it('leaves out-of-range numbers for the Worker to clamp rather than erroring', () => {
    // The old endpoint answered 400 for either of these.
    const out = run('user=a&width=100&count=99');

    expect(out.get('width')).toBe('100');
    expect(out.get('count')).toBe('99');
  });

  it('forwards a missing user so the Worker explains it on the card', () => {
    expect(run('').get('user')).toBe('');
  });

  it('uses a fixed freshness window', () => {
    expect(translate(new URLSearchParams('user=a')).maxAgeSeconds).toBe(MAX_AGE_SECONDS);
  });
});
