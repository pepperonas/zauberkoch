/** The Android shell.
 *
 * The ONLY module that imports Capacitor plugins, and it is loaded by a
 * dynamic `import()` that never runs in a browser -- so the web bundle is
 * byte-for-byte what it was. All decisions live purely in `nativeRules.ts`.
 *
 * One job so far: logging in. Google refuses OAuth inside an embedded WebView,
 * so the flow runs in a Custom Tab and comes back over `zauberkoch://login`
 * carrying a one-time handoff (see backend services/native_login.py for why
 * that token is useless to anyone who intercepts it).
 */

import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { api } from '../lib/api';
import { setGoogleLoginHandler } from '../lib/googleLogin';
import { challengeOf, makeVerifier, nativeLoginUrl, parseLoginLink } from './nativeRules';

/** The app's secret for the login run currently in flight.
 *
 * localStorage, not sessionStorage: if Android reclaims the app while the
 * Custom Tab is in front, the WebView is rebuilt and a per-tab store would be
 * gone -- taking the only thing that can redeem the handoff with it. */
const VERIFIER_KEY = 'zk-login-verifier';

const remember = (v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(VERIFIER_KEY);
    else localStorage.setItem(VERIFIER_KEY, v);
  } catch {
    /* private mode / storage disabled — login then simply fails, loudly */
  }
};
const recall = () => {
  try {
    return localStorage.getItem(VERIFIER_KEY) ?? '';
  } catch {
    return '';
  }
};

export async function init(): Promise<void> {
  // A cold start delivers the link through getLaunchUrl() AND, on some
  // Android versions, through appUrlOpen as well. Handle whichever arrives
  // first and ignore the echo, or the second pass redeems an already-spent
  // token and reports a failed login over a successful one.
  let handling = false;

  async function handleLoginLink(url: unknown): Promise<void> {
    const link = parseLoginLink(url);
    if (!link || handling) return;
    handling = true;

    // Close the tab before anything else: whatever happens next, the user
    // should be looking at the app again.
    try {
      await Browser.close();
    } catch {
      /* already closed, or never opened on this path */
    }

    if ('error' in link) {
      remember(null);
      window.location.replace(`/?login_error=${encodeURIComponent(link.error)}`);
      return;
    }

    const verifier = recall();
    try {
      await api.redeemNativeLogin(link.token, verifier);
      remember(null);
      // Full reload rather than a client-side refresh: the session cookie has
      // just appeared, and this is the same post-login entry the web flow uses
      // (the CRT reveal armed before the Custom Tab is still in sessionStorage).
      window.location.replace('/');
    } catch {
      remember(null);
      window.location.replace('/?login_error=handoff');
    }
  }

  async function startLogin(): Promise<void> {
    const verifier = makeVerifier();
    remember(verifier);
    const url = nativeLoginUrl(window.location.origin, await challengeOf(verifier));
    try {
      await Browser.open({ url, toolbarColor: '#11150f' });
    } catch {
      // No Custom Tab available. Navigating the WebView there would hit
      // Google's WebView refusal, but a visible error beats a dead button.
      window.location.href = url;
    }
  }

  setGoogleLoginHandler(() => void startLogin());
  void App.addListener('appUrlOpen', ({ url }) => void handleLoginLink(url));
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleLoginLink(launch.url);
  } catch {
    /* no launch url — the ordinary case */
  }
}
