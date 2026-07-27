/** Generation store: stream events drive global state; navigation-safe. */

import { beforeEach, describe, expect, it } from 'vitest';

import type { StreamCallbacks } from '../lib/sse';
import type { Recipe } from '../lib/types';
import {
  cancelGeneration,
  getGeneration,
  markGenerationSeen,
  retryGeneration,
  startGeneration,
  subscribeGeneration,
} from './generation';

const RECIPE: Recipe = {
  titel: 'Testgericht',
  teaser: 'Lecker.',
  kueche: 'Italienisch',
  tags: [],
  portionen: 2,
  zeit_aktiv: 10,
  zeit_gesamt: 20,
  schwierigkeit: 'einfach',
  zutaten: [{ menge: 1, einheit: 'kg', name: 'Nudeln', gruppe: '' }],
  schritte: [{ nr: 1, titel: 'Kochen', text: 'Kochen.', dauer_sek: null }],
  tipps: ['Salz.'],
  naehrwerte: null,
  glas: null,
  garnitur: null,
};

/** Runner stub: captures the callbacks so tests can fire events manually. */
function makeRunner() {
  const captured: { cb: StreamCallbacks | null; aborted: boolean; starts: number } = {
    cb: null,
    aborted: false,
    starts: 0,
  };
  const runner = (cb: StreamCallbacks) => {
    captured.cb = cb;
    captured.starts += 1;
    return () => {
      captured.aborted = true;
    };
  };
  return { captured, runner };
}

beforeEach(() => cancelGeneration());

describe('generation store', () => {
  it('streams events into global state', () => {
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'kochen');
    expect(getGeneration().phase).toBe('streaming');
    expect(getGeneration().seen).toBe(false);

    captured.cb!.onMeta!(RECIPE);
    expect(getGeneration().data.meta?.titel).toBe('Testgericht');
    expect(getGeneration().lastEvent).toBe('meta');

    captured.cb!.onZutat!(RECIPE.zutaten[0]);
    captured.cb!.onZutat!({ menge: 2, einheit: 'EL', name: 'Öl', gruppe: '' });
    expect(getGeneration().data.zutaten).toHaveLength(2);

    captured.cb!.onDone!(RECIPE);
    captured.cb!.onSaved!({ recipe_id: 7, cached: false, remaining: 12 });
    expect(getGeneration().phase).toBe('done');
    expect(getGeneration().recipeId).toBe(7);
    expect(getGeneration().remaining).toBe(12);
  });

  it('carries the BYOK "unlimited" flag instead of a countdown', () => {
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'kochen');
    captured.cb!.onSaved!({ recipe_id: 9, cached: false, remaining: null, unlimited: true });
    expect(getGeneration().unlimited).toBe(true);
    expect(getGeneration().remaining).toBeNull();
  });

  it('defaults to limited when the server omits the flag', () => {
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'kochen');
    captured.cb!.onSaved!({ recipe_id: 9, cached: false, remaining: 3 });
    expect(getGeneration().unlimited).toBe(false);
  });

  it('keeps the budget state across a cancel', () => {
    // Cancel resets the stream, not what we know about today's budget —
    // otherwise the counter would blink back to nothing on every abort.
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'kochen');
    captured.cb!.onSaved!({ recipe_id: 9, cached: false, remaining: null, unlimited: true });
    cancelGeneration();
    expect(getGeneration().phase).toBe('idle');
    expect(getGeneration().unlimited).toBe(true);
  });

  it('marks the result as seen', () => {
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'cocktail');
    captured.cb!.onSaved!({ recipe_id: 1, cached: true, remaining: 5 });
    expect(getGeneration().seen).toBe(false);
    markGenerationSeen();
    expect(getGeneration().seen).toBe(true);
  });

  it('routes daily-limit errors to the limit phase', () => {
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'kochen');
    captured.cb!.onError!({ code: 'daily_limit_user', message: 'Limit!' });
    expect(getGeneration().phase).toBe('limit');

    startGeneration(runner, 'kochen');
    captured.cb!.onError!({ code: 'network', message: 'Weg.' });
    expect(getGeneration().phase).toBe('done');
    expect(getGeneration().error?.code).toBe('network');
  });

  it('cancel aborts the stream and resets to idle', () => {
    const { captured, runner } = makeRunner();
    startGeneration(runner, 'kochen');
    cancelGeneration();
    expect(captured.aborted).toBe(true);
    expect(getGeneration().phase).toBe('idle');
  });

  it('a new start aborts the previous run; retry re-runs the last runner', () => {
    const first = makeRunner();
    startGeneration(first.runner, 'kochen');
    const second = makeRunner();
    startGeneration(second.runner, 'kochen');
    expect(first.captured.aborted).toBe(true);

    retryGeneration();
    expect(second.captured.starts).toBe(2);
  });

  it('notifies subscribers on every event', () => {
    const { captured, runner } = makeRunner();
    let ticks = 0;
    const unsub = subscribeGeneration(() => {
      ticks += 1;
    });
    startGeneration(runner, 'kochen');
    captured.cb!.onMeta!(RECIPE);
    unsub();
    captured.cb!.onZutat!(RECIPE.zutaten[0]);
    expect(ticks).toBe(2);
  });
});
