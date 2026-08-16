// @vitest-environment happy-dom
/**
 * The direction logic is what keeps the tab slide honest: a wrong answer does
 * not crash anything, it just animates the wrong way — which no other test
 * would ever notice. The DOM half is the leak contract: a stale stamp would
 * make the card→detail morph slide sideways and attach view-transition-names
 * to pages that must not carry them.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearTabTransition,
  markTabTransition,
  TAB_DIR_TTL_MS,
  TAB_ORDER,
  tabDirection,
} from './tabTransition';

afterEach(() => clearTabTransition());

describe('tabDirection', () => {
  it('moves forward when the target sits further right in the bar', () => {
    expect(tabDirection('/', '/favoriten')).toBe('fwd');
    expect(tabDirection('/', '/plan')).toBe('fwd');
    expect(tabDirection('/einkauf', '/plan')).toBe('fwd');
  });

  it('moves back when the target sits further left', () => {
    expect(tabDirection('/plan', '/')).toBe('back');
    expect(tabDirection('/verlauf', '/favoriten')).toBe('back');
  });

  it('has no direction for a click on the already-active tab', () => {
    expect(tabDirection('/verlauf', '/verlauf')).toBeNull();
  });

  it('has no direction when coming from a non-tab route', () => {
    // From the recipe detail there is no spatial relation to any tab — the
    // plain crossfade is the right answer, not a guessed slide.
    expect(tabDirection('/rezept/42', '/favoriten')).toBeNull();
    expect(tabDirection('/admin', '/')).toBeNull();
  });

  it('is antisymmetric for every tab pair', () => {
    for (const a of TAB_ORDER)
      for (const b of TAB_ORDER) {
        const there = tabDirection(a, b);
        const back = tabDirection(b, a);
        if (a === b) expect(there).toBeNull();
        else expect(there === 'fwd' ? 'back' : 'fwd').toBe(back);
      }
  });
});

describe('the html stamp', () => {
  it('stamps the direction of a tab-to-tab navigation', () => {
    markTabTransition('/', '/einkauf');
    expect(document.documentElement.dataset.tabDir).toBe('fwd');
    markTabTransition('/einkauf', '/');
    expect(document.documentElement.dataset.tabDir).toBe('back');
  });

  it('clears rather than keeps a stale stamp when there is no direction', () => {
    // A re-click on the active tab must not run with the PREVIOUS direction.
    markTabTransition('/', '/plan');
    markTabTransition('/plan', '/plan');
    expect(document.documentElement.dataset.tabDir).toBeUndefined();
  });

  it('clearTabTransition removes the stamp and tolerates absence', () => {
    markTabTransition('/', '/plan');
    clearTabTransition();
    expect(document.documentElement.dataset.tabDir).toBeUndefined();
    expect(() => clearTabTransition()).not.toThrow();
  });

  it('outlives the longest tab animation', () => {
    // 300ms slide + 70ms stagger — clearing earlier would cut the CSS scope
    // (and with it the title/tools names) out from under a running transition.
    expect(TAB_DIR_TTL_MS).toBeGreaterThan(370);
  });
});
