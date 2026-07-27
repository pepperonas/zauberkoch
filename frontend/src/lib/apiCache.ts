/** Clears the service worker's API cache on every change of account.
 *
 * The cache (`zauberkoch-api-v1`) holds one account's recipe responses under
 * URLs that are identical for every user — `/api/v1/recipes?...` is the same
 * string for you and me. It is only read when the network fails, but that is
 * exactly the shared-device case: person A signs out, person B signs in, the
 * train goes into a tunnel, and B's favourites list is A's.
 *
 * Called on logout and after a successful login. Best-effort by design: no
 * service worker (dev, unsupported browser, first visit before activation)
 * simply means there is no cache to clear.
 */
export const LAST_ACCOUNT_KEY = 'zk-last-account';

/** Should the cache be dropped when the signed-in account goes `previous` →
 * `current`? ('' = signed out.)
 *
 * Deliberately NOT "clear whenever someone logs in": every page load resolves
 * `me` from nothing to an id, so that would wipe the cache on every start and
 * leave nothing readable offline. Only a real change of identity counts —
 * signing out, or a different account appearing without a sign-out in between.
 */
export function shouldClearApiCache(previous: string, current: string): boolean {
  if (previous === current) return false;
  return previous !== ''; // first-ever resolution has nothing to protect
}

export function clearApiCache(): void {
  // Every step is optional on purpose: no service worker (dev server, older
  // browser, first visit before activation) means there is no cache to clear.
  // NOTE: `.catch` has to be optional-chained too — `undefined.catch(...)`
  // would throw in exactly the browsers that have nothing to clear.
  navigator.serviceWorker?.ready
    ?.then((reg) => reg.active?.postMessage({ type: 'zk-clear-api-cache' }))
    ?.catch(() => {
      /* nothing cached, nothing to clear */
    });
}
