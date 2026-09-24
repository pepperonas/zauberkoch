// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_LOGIN_PATH, setGoogleLoginHandler, startGoogleLogin } from './googleLogin';

/** happy-dom would try to navigate for real; swap the whole location object. */
function watchNavigation(): { href: string } {
  const fake = { href: '' };
  Object.defineProperty(window, 'location', { value: fake, writable: true, configurable: true });
  return fake;
}

afterEach(() => setGoogleLoginHandler(null));

describe('starting the Google login', () => {
  it('navigates to the backend in a browser', () => {
    const loc = watchNavigation();
    startGoogleLogin();
    expect(loc.href).toBe(GOOGLE_LOGIN_PATH);
  });

  it('lets the shell take over instead', () => {
    // This is the whole reason the indirection exists: inside the app the same
    // call must open a Custom Tab, because Google refuses OAuth in a WebView.
    const loc = watchNavigation();
    const custom = vi.fn();
    setGoogleLoginHandler(custom);
    startGoogleLogin();
    expect(custom).toHaveBeenCalledOnce();
    expect(loc.href).toBe('');
  });

  it('falls back again once the handler is withdrawn', () => {
    const loc = watchNavigation();
    setGoogleLoginHandler(vi.fn());
    setGoogleLoginHandler(null);
    startGoogleLogin();
    expect(loc.href).toBe(GOOGLE_LOGIN_PATH);
  });
});
