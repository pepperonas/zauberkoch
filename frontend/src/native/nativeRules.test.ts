import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOGIN_SCHEME,
  challengeOf,
  isNativeShell,
  linkTarget,
  makeVerifier,
  nativeLoginUrl,
  parseLoginLink,
} from './nativeRules';

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

describe('the two ways an engine may parse a custom scheme', () => {
  // These cases cannot BOTH be produced by one `new URL()`: Node parses a host
  // for custom schemes, Chromium does not. Testing the rule directly is the
  // only way this file can cover the shape the app actually sees -- and the
  // shape it actually sees is the one that was broken on a device while every
  // test here was green.
  it('reads the host when the engine parsed one (Node)', () => {
    expect(linkTarget('login', '')).toBe('login');
  });

  it('reads the first path segment when it did not (Chromium)', () => {
    expect(linkTarget('', '//login')).toBe('login');
  });

  it('keeps a trailing path out of it', () => {
    expect(linkTarget('', '//login/extra')).toBe('login');
    expect(linkTarget('login', '/extra')).toBe('login');
  });

  it('still tells a wrong target apart in both shapes', () => {
    expect(linkTarget('', '//logout')).toBe('logout');
    expect(linkTarget('logout', '')).toBe('logout');
  });

  it('is empty when there is nothing to read', () => {
    expect(linkTarget('', '')).toBe('');
    expect(linkTarget('', '//')).toBe('');
  });
});

describe('the return link as the app\'s engine actually parses it', () => {
  /** Chromium's parse of a custom scheme: no authority, everything in the
   * path. Node cannot produce this, so the engine is emulated -- otherwise a
   * refactor back to `u.hostname` would leave this suite green while every
   * native login silently did nothing, which is exactly what happened once. */
  class ChromiumUrl {
    // `!`: for a special scheme the constructor returns a real URL instead,
    // which replaces `this` entirely — these fields are then never observed.
    protocol!: string;
    hostname = '';
    pathname!: string;
    searchParams!: URLSearchParams;
    constructor(raw: string, base?: string) {
      const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^?#]*)(\?[^#]*)?/.exec(raw);
      if (!m || /^(https?|ftp|ws|wss|file)$/i.test(m[1])) return new Real(raw, base) as never;
      this.protocol = `${m[1]}:`;
      this.pathname = `//${m[2]}`;
      this.searchParams = new URLSearchParams(m[3] ?? '');
    }
  }
  const Real = globalThis.URL;

  beforeEach(() => {
    globalThis.URL = ChromiumUrl as unknown as typeof URL;
  });
  afterEach(() => {
    globalThis.URL = Real;
  });

  it('still finds the token', () => {
    expect(parseLoginLink(`${LOGIN_SCHEME}://login?t=abc123`)).toEqual({ token: 'abc123' });
  });

  it('still finds a failure', () => {
    expect(parseLoginLink(`${LOGIN_SCHEME}://login?error=cancelled`)).toEqual({ error: 'cancelled' });
  });

  it('still rejects the wrong target', () => {
    expect(parseLoginLink(`${LOGIN_SCHEME}://logout?t=abc`)).toBeNull();
  });

  it('still rejects a foreign scheme', () => {
    expect(parseLoginLink('kiezfinder://login?t=abc')).toBeNull();
  });

  it('proves the emulation really differs from Node', () => {
    // Guards the guard: if this stub ever stopped behaving like Chromium, the
    // four tests above would quietly become duplicates of the Node ones.
    expect(new URL(`${LOGIN_SCHEME}://login?t=1`).hostname).toBe('');
    expect(new Real(`${LOGIN_SCHEME}://login?t=1`).hostname).toBe('login');
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
