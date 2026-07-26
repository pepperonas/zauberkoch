/**
 * AI-budget notice helpers: the reset-time label (shown as "wieder verfügbar
 * ab HH:MM Uhr") derived from the server's `retry_after` seconds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetTimeLabel } from './AiBudgetNotice';

afterEach(() => vi.useRealTimers());

describe('resetTimeLabel', () => {
  it('is empty without a usable retry_after (no misleading time)', () => {
    expect(resetTimeLabel(undefined)).toBe('');
    expect(resetTimeLabel(0)).toBe('');
    expect(resetTimeLabel(-5)).toBe('');
  });

  it('renders the local wall-clock time the budget returns', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T20:15:00'));
    // +3h45m -> 00:00 local
    expect(resetTimeLabel(3 * 3600 + 45 * 60)).toBe('ab 00:00 Uhr');
    // +90 min -> 21:45
    expect(resetTimeLabel(90 * 60)).toBe('ab 21:45 Uhr');
  });

  it('pads to two digits so the label never jitters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T05:00:00'));
    expect(resetTimeLabel(4 * 60)).toBe('ab 05:04 Uhr'); // not "5:4"
  });
});
