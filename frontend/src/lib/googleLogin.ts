/** Where "log in with Google" goes.
 *
 * In a browser: straight to the backend, exactly as before. Inside the Android
 * shell the same call opens a Custom Tab instead, because Google refuses OAuth
 * in an embedded WebView (`disallowed_useragent`).
 *
 * The indirection exists so the call sites stay honest: they still just say
 * "start the Google login" and know nothing about Capacitor. The shell
 * registers its handler during init; if it never loads -- the web case -- the
 * default is the original navigation.
 */

export const GOOGLE_LOGIN_PATH = '/api/v1/auth/login';

let handler: (() => void) | null = null;

/** Called once by src/native/index.ts, which only loads inside the app. */
export function setGoogleLoginHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function startGoogleLogin(): void {
  if (handler) {
    handler();
    return;
  }
  window.location.href = GOOGLE_LOGIN_PATH;
}
