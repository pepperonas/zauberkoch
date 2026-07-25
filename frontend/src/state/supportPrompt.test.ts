// @vitest-environment happy-dom
/**
 * Support-nudge gating (state/supportPrompt.ts). Covers the pure decision
 * (shouldPrompt) plus the localStorage-backed transitions: count, first ask at
 * the threshold, quiet-then-return after a soft dismiss, permanent silence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIRST_THRESHOLD,
  REPEAT_EVERY,
  _resetSupportPrompt,
  dismissSupport,
  recordGeneration,
  shouldPrompt,
  type SupportState,
} from './supportPrompt';

const S = (count: number, shownAt: number | null = null, silenced = false): SupportState => ({
  count,
  shownAt,
  silenced,
});

beforeEach(() => {
  localStorage.clear();
  _resetSupportPrompt();
});
afterEach(() => localStorage.clear());

describe('shouldPrompt — pure decision', () => {
  it('stays hidden below the first threshold', () => {
    expect(shouldPrompt(S(0))).toBe(false);
    expect(shouldPrompt(S(FIRST_THRESHOLD - 1))).toBe(false);
  });

  it('shows first at the threshold when never shown', () => {
    expect(shouldPrompt(S(FIRST_THRESHOLD))).toBe(true);
    expect(shouldPrompt(S(FIRST_THRESHOLD + 3))).toBe(true);
  });

  it('stays quiet after a dismiss until REPEAT_EVERY more recipes', () => {
    const shownAt = FIRST_THRESHOLD;
    expect(shouldPrompt(S(shownAt + 1, shownAt))).toBe(false);
    expect(shouldPrompt(S(shownAt + REPEAT_EVERY - 1, shownAt))).toBe(false);
    expect(shouldPrompt(S(shownAt + REPEAT_EVERY, shownAt))).toBe(true);
  });

  it('never shows once silenced, regardless of count', () => {
    expect(shouldPrompt(S(FIRST_THRESHOLD, null, true))).toBe(false);
    expect(shouldPrompt(S(999, 5, true))).toBe(false);
  });
});

describe('store transitions', () => {
  it('counts generations and crosses the threshold', () => {
    for (let i = 0; i < FIRST_THRESHOLD - 1; i++) recordGeneration();
    expect(localStorage.getItem('zk-recipe-count')).toBe(String(FIRST_THRESHOLD - 1));
    recordGeneration(); // the 5th
    expect(localStorage.getItem('zk-recipe-count')).toBe(String(FIRST_THRESHOLD));
  });

  it('soft dismiss returns after enough further recipes', () => {
    for (let i = 0; i < FIRST_THRESHOLD; i++) recordGeneration();
    dismissSupport(false);
    expect(localStorage.getItem('zk-support-shown-at')).toBe(String(FIRST_THRESHOLD));
    expect(localStorage.getItem('zk-support-off')).toBeNull();
    // exactly REPEAT_EVERY more recipes re-arm it
    for (let i = 0; i < REPEAT_EVERY - 1; i++) recordGeneration();
    expect(shouldPrompt(readState())).toBe(false);
    recordGeneration();
    expect(shouldPrompt(readState())).toBe(true);
  });

  it('permanent dismiss silences it for good', () => {
    for (let i = 0; i < FIRST_THRESHOLD; i++) recordGeneration();
    dismissSupport(true);
    expect(localStorage.getItem('zk-support-off')).toBe('1');
    for (let i = 0; i < REPEAT_EVERY + 5; i++) recordGeneration();
    expect(shouldPrompt(readState())).toBe(false);
  });
});

/** Reconstruct the state the store would report, straight from localStorage. */
function readState(): SupportState {
  const count = Number(localStorage.getItem('zk-recipe-count')) || 0;
  const shownRaw = localStorage.getItem('zk-support-shown-at');
  return {
    count,
    shownAt: shownRaw === null ? null : Number(shownRaw),
    silenced: localStorage.getItem('zk-support-off') === '1',
  };
}
