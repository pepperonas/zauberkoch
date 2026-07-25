/** Gentle "support Zauberkoch" nudge — shown after a handful of generated
 * recipes, offering to donate, send feedback, or leave a Google review.
 *
 * Deliberately restrained (project rule: the pull layer must never be
 * manipulative): first ask at FIRST_THRESHOLD recipes, and if the user just
 * dismisses it, stay quiet for REPEAT_EVERY more before asking once more.
 * Acting on any option, or "don't ask again", silences it for good.
 *
 * State lives in localStorage and is exposed as an external store so the shell
 * can react the moment a generation pushes the count over the line.
 */

import { useSyncExternalStore } from 'react';

export const FIRST_THRESHOLD = 5;
export const REPEAT_EVERY = 25;

const COUNT_KEY = 'zk-recipe-count';
const SHOWN_KEY = 'zk-support-shown-at';
const SILENCED_KEY = 'zk-support-off';

export interface SupportState {
  /** Total recipes the signed-in user has generated. */
  count: number;
  /** Count at which the prompt was last shown (null = never shown). */
  shownAt: number | null;
  /** User opted out permanently (acted, or chose "don't ask again"). */
  silenced: boolean;
}

/** Pure decision: should the prompt be visible for this state? */
export function shouldPrompt(s: SupportState): boolean {
  if (s.silenced || s.count < FIRST_THRESHOLD) return false;
  if (s.shownAt === null) return true;
  return s.count >= s.shownAt + REPEAT_EVERY;
}

// localStorage is absent in node (SSR / the node-env generation-store tests);
// every access is guarded so the store is a harmless no-op there.
const HAS_LS = typeof localStorage !== 'undefined';
const lsGet = (key: string): string | null => (HAS_LS ? localStorage.getItem(key) : null);
const lsSet = (key: string, value: string): void => {
  if (HAS_LS) localStorage.setItem(key, value);
};

function readInt(key: string): number {
  const raw = Number(lsGet(key));
  return Number.isFinite(raw) ? raw : 0;
}

function read(): SupportState {
  return {
    count: readInt(COUNT_KEY),
    shownAt: lsGet(SHOWN_KEY) === null ? null : readInt(SHOWN_KEY),
    silenced: lsGet(SILENCED_KEY) === '1',
  };
}

let state = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Count one completed generation (called from the generation store). */
export function recordGeneration(): void {
  state = { ...state, count: state.count + 1 };
  lsSet(COUNT_KEY, String(state.count));
  emit();
}

/** Dismiss the prompt. `forever` silences it; otherwise it may return later. */
export function dismissSupport(forever: boolean): void {
  state = { ...state, shownAt: state.count, silenced: state.silenced || forever };
  lsSet(SHOWN_KEY, String(state.count));
  if (forever) lsSet(SILENCED_KEY, '1');
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Whether the support prompt should currently be shown. */
export function useSupportPrompt(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shouldPrompt(state),
    () => false,
  );
}

/** Test-only: reset in-memory + persisted state. */
export function _resetSupportPrompt(): void {
  localStorage.removeItem(COUNT_KEY);
  localStorage.removeItem(SHOWN_KEY);
  localStorage.removeItem(SILENCED_KEY);
  state = { count: 0, shownAt: null, silenced: false };
  emit();
}
