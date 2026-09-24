/** Pure rules for the Android shell.
 *
 * Nothing here imports a Capacitor plugin, so these can be unit-tested in node
 * and -- more importantly -- the module stays cheap enough that the decision
 * "are we in the app at all?" never drags a plugin chunk into the web bundle.
 */

/** Custom URL scheme the app registers for the login handoff.
 *
 * Three layers must agree: this constant, `LOGIN_SCHEME` in the backend's
 * `services/native_login.py`, and `custom_url_scheme` in the Android string
 * resources. A mismatch is invisible in every browser and breaks login in the
 * shipped app only, so a pytest pins all three against each other.
 *
 * Reverse-DNS on purpose: a bare word is trivially claimed by another app.
 * That does not make the handoff safe on its own -- nothing does, Android
 * schemes are never exclusive -- it just makes an accidental clash unlikely.
 * The actual defence is the verifier. */
export const LOGIN_SCHEME = 'io.celox.zauberkoch';

/** Where the backend sends a Custom-Tab login. `native=1` tells the callback
 * to hand the session back over the scheme instead of cookie-ing the browser;
 * `cc` binds the run to a secret only this app knows. */
export function nativeLoginUrl(origin: string, challenge: string): string {
  return `${origin}/api/v1/auth/login?native=1&cc=${encodeURIComponent(challenge)}`;
}

export type LoginLink = { token: string } | { error: string } | null;

/** Read the return link from the Custom Tab.
 *
 * Deliberately strict about scheme AND host: the shell is handed every intent
 * the system routes at it, and a link that merely looks close enough must not
 * be mistaken for the end of a login. */
export function parseLoginLink(url: unknown): LoginLink {
  if (typeof url !== 'string' || !url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${LOGIN_SCHEME}:` || u.hostname !== 'login') return null;
  const token = u.searchParams.get('t');
  if (token) return { token };
  const error = u.searchParams.get('error');
  return error ? { error } : null;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh secret for one login run: 32 random bytes, base64url. */
export function makeVerifier(source: Crypto = globalThis.crypto): string {
  const bytes = new Uint8Array(32);
  source.getRandomValues(bytes);
  return base64url(bytes);
}

/** Fingerprint of the secret that travels through the browser.
 *
 * Must stay character-identical to `challenge_for` in the backend's
 * `services/native_login.py` -- otherwise the app can never prove ownership
 * and every native login fails. Both sides pin the same test vector. */
export async function challengeOf(verifier: string, source: Crypto = globalThis.crypto): Promise<string> {
  const digest = await source.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Are we running inside the shell? Reads the global Capacitor injects into
 * the WebView rather than importing `@capacitor/core`, which would put the
 * runtime into the web bundle for the sake of answering "no". */
export function isNativeShell(win: unknown = globalThis.window): boolean {
  const cap = (win as { Capacitor?: { isNativePlatform?: () => boolean } } | undefined)?.Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform() === true;
}
