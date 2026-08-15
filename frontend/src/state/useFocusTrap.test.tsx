// @vitest-environment happy-dom
/**
 * The focus trap is an accessibility promise, not a nicety: without it a
 * keyboard user tabs straight out of an open dialog into the page behind it
 * and has no way of knowing where they are. The three behaviours that make it
 * work — focus in, cycle inside, restore on close — are asserted here.
 *
 * happy-dom reports `offsetParent` as null for everything (it does no layout),
 * which the hook uses as its visibility test, so it is stubbed to mean
 * "rendered" and flipped per element where a test needs something hidden.
 */
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusTrap } from './useFocusTrap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];
const hidden = new WeakSet<Element>();

beforeEach(() => {
  vi.useFakeTimers();
  // happy-dom does no layout: treat every element as rendered unless a test
  // explicitly hides it.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return hidden.has(this) ? null : this.parentElement;
    },
  });
});

afterEach(() => {
  act(() => mounted.splice(0).forEach((r) => r.unmount()));
  vi.useRealTimers();
});

/**
 * Mounts a panel with the given innerHTML into the document (focus only works
 * for attached nodes) and returns handles to drive it.
 */
function mountTrap(innerHTML: string, active = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const state = { active };
  const Trap = () => {
    const ref = useFocusTrap<HTMLDivElement>(state.active);
    useEffect(() => {
      if (ref.current) ref.current.innerHTML = innerHTML;
    }, [ref]);
    return createElement('div', { ref });
  };

  const root = createRoot(host);
  mounted.push(root);
  act(() => root.render(createElement(Trap)));

  const panel = host.querySelector('div') as HTMLDivElement;

  return {
    panel,
    host,
    close: () => act(() => root.unmount()) as unknown as void,
    button: (label: string) =>
      [...panel.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement,
    tab: (shiftKey = false) =>
      act(() => {
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
      }),
  };
}

const PANEL = '<button>Erste</button><button>Mitte</button><button>Letzte</button>';

describe('entering the trap', () => {
  it('moves focus to the first focusable element', () => {
    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    expect(document.activeElement).toBe(trap.button('Erste'));
  });

  it('does nothing while inactive', () => {
    const before = document.activeElement;
    mountTrap(PANEL, false);
    act(() => vi.advanceTimersByTime(50));
    expect(document.activeElement).toBe(before);
  });

  it('skips disabled controls when choosing the first target', () => {
    const trap = mountTrap('<button disabled>Aus</button><button>Aktiv</button>');
    act(() => vi.advanceTimersByTime(50));
    expect(document.activeElement).toBe(trap.button('Aktiv'));
  });

  it('skips elements that are not rendered', () => {
    const trap = mountTrap(PANEL);
    hidden.add(trap.button('Erste'));
    act(() => vi.advanceTimersByTime(50));
    expect(document.activeElement).toBe(trap.button('Mitte'));
  });
});

describe('cycling inside', () => {
  it('wraps from the last element back to the first', () => {
    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    trap.button('Letzte').focus();

    trap.tab();

    expect(document.activeElement).toBe(trap.button('Erste'));
  });

  it('wraps backwards from the first element to the last', () => {
    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    trap.button('Erste').focus();

    trap.tab(true);

    expect(document.activeElement).toBe(trap.button('Letzte'));
  });

  it('leaves the browser to handle a Tab in the middle', () => {
    // Only the two edges need intercepting; hijacking every Tab would break
    // the natural order inside the dialog.
    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    trap.button('Mitte').focus();

    trap.tab();

    expect(document.activeElement).toBe(trap.button('Mitte'));
  });

  it('pulls focus back in when it has escaped the panel', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    outside.focus();

    trap.tab();

    expect(document.activeElement).toBe(trap.button('Erste'));
    outside.remove();
  });

  it('ignores keys other than Tab', () => {
    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    trap.button('Letzte').focus();

    act(() => {
      trap.panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });

    expect(document.activeElement).toBe(trap.button('Letzte'));
  });

  it('does not throw on an empty panel', () => {
    const trap = mountTrap('<p>Nur Text</p>');
    act(() => vi.advanceTimersByTime(50));
    expect(() => trap.tab()).not.toThrow();
  });
});

describe('leaving the trap', () => {
  it('restores focus to whatever was focused before', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const trap = mountTrap(PANEL);
    act(() => vi.advanceTimersByTime(50));
    expect(document.activeElement).not.toBe(opener);

    trap.close();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('cancels the pending focus timer on a fast open/close', () => {
    // Closing within the 30 ms grace period must not steal focus afterwards.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const trap = mountTrap(PANEL);
    trap.close();
    act(() => vi.advanceTimersByTime(100));

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
