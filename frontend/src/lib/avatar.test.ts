/** The header avatar URL rewriter.
 *
 * Two things are worth pinning: that a sharp size is actually requested (the
 * whole point), and that we never touch a URL we do not understand — this
 * function edits a string that is then handed to a third-party server.
 */
import { describe, expect, it } from 'vitest';

import { avatarSrc } from './avatar';

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocJzIPVNIh6nsKI6rkLD=s96-c';

describe('avatarSrc', () => {
  it('asks Google for the size the slot really needs', () => {
    // 34 CSS px on a DPR-3 phone is 102 device pixels — Google's stock 96 is
    // an upscale, which is exactly the softness this function exists to fix.
    expect(avatarSrc(GOOGLE, 34, 3)).toBe(
      'https://lh3.googleusercontent.com/a/ACg8ocJzIPVNIh6nsKI6rkLD=s102-c',
    );
    expect(avatarSrc(GOOGLE, 34, 1)).toContain('=s34-c');
    expect(avatarSrc(GOOGLE, 34, 2)).toContain('=s68-c');
  });

  it('keeps the crop flag', () => {
    // Without `-c` Google returns the uncropped original, which is rarely
    // square — the circular mask would then cut the face off-centre.
    expect(avatarSrc(GOOGLE, 34, 3)).toMatch(/-c$/);
  });

  it('rounds up rather than down', () => {
    // A fractional DPR (1.5 on many Android tablets) must never land BELOW
    // the needed pixels, or we are back to upscaling.
    expect(avatarSrc(GOOGLE, 34, 1.5)).toContain('=s51-c');
    expect(avatarSrc(GOOGLE, 33, 1.5)).toContain('=s50-c'); // 49.5 -> 50
  });

  it('leaves a foreign host completely alone', () => {
    // We only understand Google's option syntax. Editing someone else's URL
    // on a guess corrupts it — and this string is sent to their server.
    for (const other of [
      'https://example.com/avatar=s96-c.png',
      'https://evil.googleusercontent.com.attacker.test/a/x=s96-c',
      'https://gravatar.com/avatar/abc?s=96',
    ]) {
      expect(avatarSrc(other, 34, 3)).toBe(other);
    }
  });

  it('accepts googleusercontent subdomains, not a lookalike suffix', () => {
    expect(avatarSrc('https://lh5.googleusercontent.com/a/x=s96-c', 34, 3)).toContain('=s102');
    expect(avatarSrc('https://notgoogleusercontent.com/a/x=s96-c', 34, 3)).toContain('=s96');
  });

  it('passes through what it cannot parse or has no size to change', () => {
    expect(avatarSrc('', 34, 3)).toBe('');
    expect(avatarSrc('not a url', 34, 3)).toBe('not a url');
    // No size token: appending options to an unknown block is how you 404.
    const plain = 'https://lh3.googleusercontent.com/a/ACg8ocJzIP';
    expect(avatarSrc(plain, 34, 3)).toBe(plain);
  });

  it('caps the size it will ever request', () => {
    expect(avatarSrc(GOOGLE, 4000, 3)).toContain('=s512-c');
  });
});
