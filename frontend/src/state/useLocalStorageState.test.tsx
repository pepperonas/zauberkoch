// @vitest-environment happy-dom
/**
 * useLocalStorageState backs the wizard's remembered choices (max time,
 * difficulty) and the shopping list's view toggle. Its whole job is that a
 * reload does not throw the user's setting away, so the write-through and the
 * read-on-mount are what the tests hold on to.
 *
 * Same lightweight renderHook as useOnline.test.tsx — no @testing-library.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useLocalStorageState } from './useLocalStorageState';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

beforeEach(() => localStorage.clear());
afterEach(() => act(() => mounted.splice(0).forEach((r) => r.unmount())));

function renderHook<T>(useHook: () => T) {
  const result = { current: undefined as T };
  const Probe = () => {
    result.current = useHook();
    return null;
  };
  const root = createRoot(document.createElement('div'));
  mounted.push(root);
  act(() => root.render(createElement(Probe)));
  return { result };
}

describe('initial value', () => {
  it('falls back to the initializer when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStorageState('zk-test', () => 'mittel'));
    expect(result.current[0]).toBe('mittel');
  });

  it('prefers a stored value over the initializer', () => {
    localStorage.setItem('zk-test', 'anspruchsvoll');
    const { result } = renderHook(() => useLocalStorageState('zk-test', () => 'mittel'));
    expect(result.current[0]).toBe('anspruchsvoll');
  });

  it('does not write the default back to storage on mount', () => {
    // Persisting an untouched default would make "never chosen" and "chose the
    // default" indistinguishable if the default ever changes.
    renderHook(() => useLocalStorageState('zk-test', () => 'mittel'));
    expect(localStorage.getItem('zk-test')).toBeNull();
  });

  it('calls the initializer lazily — once, and only when needed', () => {
    let calls = 0;
    localStorage.setItem('zk-test', 'gespeichert');
    const { result } = renderHook(() =>
      useLocalStorageState('zk-test', () => {
        calls += 1;
        return 'teuer';
      }),
    );
    expect(result.current[0]).toBe('gespeichert');
    expect(calls).toBe(0);
  });

  it('treats a stored empty string as a real value, not as absent', () => {
    localStorage.setItem('zk-test', '');
    const { result } = renderHook(() => useLocalStorageState('zk-test', () => 'fallback'));
    expect(result.current[0]).toBe('');
  });
});

describe('writing', () => {
  it('updates the state and persists in one step', () => {
    const { result } = renderHook(() => useLocalStorageState('zk-test', () => 'a'));

    act(() => result.current[1]('b'));

    expect(result.current[0]).toBe('b');
    expect(localStorage.getItem('zk-test')).toBe('b');
  });

  it('supports a functional updater based on the previous value', () => {
    const { result } = renderHook(() => useLocalStorageState('zk-count', () => '1'));

    act(() => result.current[1]((prev) => String(Number(prev) + 1)));

    expect(result.current[0]).toBe('2');
    expect(localStorage.getItem('zk-count')).toBe('2');
  });

  it('persists every step of a burst, not just the first', () => {
    const { result } = renderHook(() => useLocalStorageState('zk-count', () => '0'));

    act(() => {
      result.current[1]((p) => String(Number(p) + 1));
      result.current[1]((p) => String(Number(p) + 1));
      result.current[1]((p) => String(Number(p) + 1));
    });

    expect(result.current[0]).toBe('3');
    expect(localStorage.getItem('zk-count')).toBe('3');
  });

  it('survives a remount — the point of the hook', () => {
    const { result } = renderHook(() => useLocalStorageState('zk-test', () => 'a'));
    act(() => result.current[1]('gemerkt'));

    const second = renderHook(() => useLocalStorageState('zk-test', () => 'a'));
    expect(second.result.current[0]).toBe('gemerkt');
  });

  it('keeps separate keys apart', () => {
    const a = renderHook(() => useLocalStorageState('zk-a', () => 'a'));
    const b = renderHook(() => useLocalStorageState('zk-b', () => 'b'));

    act(() => a.result.current[1]('geändert'));

    expect(b.result.current[0]).toBe('b');
    expect(localStorage.getItem('zk-b')).toBeNull();
  });

  it('hands back a stable setter across re-renders', () => {
    // An unstable setter would re-fire every effect that depends on it.
    const { result } = renderHook(() => useLocalStorageState('zk-test', () => 'a'));
    const first = result.current[1];

    act(() => result.current[1]('b'));

    expect(result.current[1]).toBe(first);
  });
});
