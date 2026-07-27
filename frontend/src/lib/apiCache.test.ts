// @vitest-environment happy-dom
/** When the service worker's API cache must be dropped.
 *
 * The cache holds one account's recipes under URLs identical for everyone, so
 * it must not outlive a change of account — but clearing it too eagerly would
 * leave nothing readable offline, which is the whole point of having it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearApiCache, shouldClearApiCache } from './apiCache';

describe('shouldClearApiCache', () => {
  it('clears on sign-out', () => {
    expect(shouldClearApiCache('7', '')).toBe(true);
  });

  it('clears when a different account appears without a sign-out in between', () => {
    expect(shouldClearApiCache('7', '9')).toBe(true);
  });

  it('does NOT clear on a plain page load of the same account', () => {
    // The regression this guards: every load resolves `me` from nothing to an
    // id, so a naive "clear on login" wipes the offline cache every start.
    expect(shouldClearApiCache('7', '7')).toBe(false);
  });

  it('does NOT clear on the first ever visit', () => {
    expect(shouldClearApiCache('', '7')).toBe(false);
  });

  it('does NOT clear while signed out and staying signed out', () => {
    expect(shouldClearApiCache('', '')).toBe(false);
  });
});

describe('clearApiCache', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the clear message to the active worker', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ active: { postMessage } }) },
    });
    clearApiCache();
    await Promise.resolve();
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({ type: 'zk-clear-api-cache' });
  });

  it('does nothing where service workers are unavailable', () => {
    // The browsers with nothing to clear are exactly the ones that used to
    // crash here: `undefined.catch(...)`.
    vi.stubGlobal('navigator', {});
    expect(() => clearApiCache()).not.toThrow();
  });

  it('survives a worker that never activates', () => {
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } });
    expect(() => clearApiCache()).not.toThrow();
  });
});
