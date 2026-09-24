import { describe, expect, it } from 'vitest';

import { LOGIN_SCHEME, challengeOf, isNativeShell, makeVerifier, nativeLoginUrl, parseLoginLink } from './nativeRules';

describe('the fingerprint the app sends through the browser', () => {
  it('matches the backend byte for byte', async () => {
    // The SAME vector is asserted in backend/tests/test_native_login.py. If the
    // two implementations ever drift, the app can no longer prove ownership of
    // its own login and every native sign-in fails — with no error to read.
    await expect(challengeOf('hello')).resolves.toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
  });

  it('is base64url without padding', async () => {
    const c = await challengeOf(makeVerifier());
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('the secret that never leaves the app', () => {
  it('is 32 random bytes in base64url', () => {
    expect(makeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is different every run', () => {
    const seen = new Set(Array.from({ length: 50 }, () => makeVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe('the return link from the Custom Tab', () => {
  it('reads the handoff token', () => {
    expect(parseLoginLink(`${LOGIN_SCHEME}://login?t=abc123`)).toEqual({ token: 'abc123' });
  });

  it('reads a failure', () => {
    expect(parseLoginLink(`${LOGIN_SCHEME}://login?error=cancelled`)).toEqual({ error: 'cancelled' });
  });

  it('prefers the token when a link somehow carries both', () => {
    expect(parseLoginLink(`${LOGIN_SCHEME}://login?t=abc&error=cancelled`)).toEqual({ token: 'abc' });
  });

  it.each([
    ['a foreign scheme', 'https://login?t=abc'],
    ['a scheme that merely looks close', `${LOGIN_SCHEME}x://login?t=abc`],
    ['the right scheme at the wrong host', `${LOGIN_SCHEME}://logout?t=abc`],
    ['no payload at all', `${LOGIN_SCHEME}://login`],
    ['an empty token', `${LOGIN_SCHEME}://login?t=`],
    ['nonsense', 'not a url'],
    ['nothing', ''],
  ])('is not fooled by %s', (_name, url) => {
    // The shell is handed every intent the system routes at it — a link that
    // merely looks close must not be mistaken for the end of a login.
    expect(parseLoginLink(url)).toBeNull();
  });

  it.each([null, undefined, 42, {}])('survives a non-string (%s)', (v) => {
    expect(parseLoginLink(v)).toBeNull();
  });
});

describe('where the Custom Tab is pointed', () => {
  it('marks the run as native and carries the challenge', () => {
    expect(nativeLoginUrl('https://zauberkoch.de', 'abc-_123')).toBe(
      'https://zauberkoch.de/api/v1/auth/login?native=1&cc=abc-_123',
    );
  });

  it('escapes a challenge that would otherwise break the query', () => {
    expect(nativeLoginUrl('https://x.de', 'a+b/c=')).toContain('cc=a%2Bb%2Fc%3D');
  });
});

describe('am I in the shell?', () => {
  it('says no in a plain browser', () => {
    expect(isNativeShell({})).toBe(false);
    expect(isNativeShell(undefined)).toBe(false);
  });

  it('says no when Capacitor is present but running on the web', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
  });

  it('says yes only for a real native platform', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
  });

  it('is not fooled by a truthy non-function', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: 'yes' } })).toBe(false);
  });
});
