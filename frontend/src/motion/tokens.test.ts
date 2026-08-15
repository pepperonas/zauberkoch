/**
 * Motion tokens are the single source of truth for the app's physics, and the
 * project rules make two promises about them that nothing else enforces:
 *
 *   1. spatial springs may overshoot, effects springs NEVER may — a fading
 *      element that wobbles past opacity 1 and back reads as a glitch;
 *   2. presets animate only `transform`/`opacity`, so every animation stays on
 *      the compositor (60 fps on mid-range Android).
 *
 * Both are one-character changes away from being broken, and neither shows up
 * in a type error or a failing render. Hence this file.
 */
import { describe, expect, it } from 'vitest';

import * as tokens from './tokens';
import {
  countUp,
  defaultSpatial,
  dismissDip,
  effectsDefault,
  effectsFast,
  errorIn,
  fastSpatial,
  heroEnter,
  heroItem,
  pressStar,
  reducedFade,
  rewardPop,
  shuffleWiggle,
  slowSpatial,
  staggerIn,
} from './tokens';

const SPATIAL = { fastSpatial, defaultSpatial, slowSpatial };
const EFFECTS = { effectsFast, effectsDefault, countUp };

/** Properties that are safe to animate: compositor-only. */
const COMPOSITED = new Set(['opacity', 'x', 'y', 'scale', 'rotate', 'skew', 'skewX', 'skewY', 'transform']);

describe('spring classes', () => {
  it.each(Object.entries(SPATIAL))('%s is a spring with visible overshoot', (_name, spring) => {
    expect(spring.type).toBe('spring');
    expect(spring.bounce).toBeGreaterThan(0);
  });

  it.each(Object.entries(EFFECTS))('%s is a spring that never overshoots', (_name, spring) => {
    expect(spring.type).toBe('spring');
    expect(spring.bounce).toBe(0);
  });

  it('orders the spatial springs fast < default < slow', () => {
    expect(fastSpatial.visualDuration).toBeLessThan(defaultSpatial.visualDuration as number);
    expect(defaultSpatial.visualDuration).toBeLessThan(slowSpatial.visualDuration as number);
  });

  it('gives the hero moment the most bounce', () => {
    expect(slowSpatial.bounce).toBeGreaterThan(defaultSpatial.bounce as number);
  });

  it.each([...Object.entries(SPATIAL), ...Object.entries(EFFECTS)])(
    '%s uses the physical spring API, not hand-tuned stiffness/damping',
    (_name, spring) => {
      expect(spring.visualDuration).toBeGreaterThan(0);
      expect(spring).not.toHaveProperty('stiffness');
      expect(spring).not.toHaveProperty('damping');
    },
  );

  it.each(Object.entries({ ...SPATIAL, ...EFFECTS }))('%s stays under a second', (_name, spring) => {
    // A spring longer than this stops reading as a response to the tap.
    expect(spring.visualDuration).toBeLessThanOrEqual(1);
  });
});

describe('reduced motion', () => {
  it('is a flat, short fade rather than a spring', () => {
    expect(reducedFade).not.toHaveProperty('type', 'spring');
    expect(reducedFade.ease).toBe('linear');
    expect(reducedFade.duration).toBeLessThanOrEqual(0.2);
  });
});

describe('staggerIn', () => {
  it('turns an index into a proportional delay', () => {
    expect(staggerIn(0).delay).toBe(0);
    expect(staggerIn(3, 0.05).delay).toBeCloseTo(0.15);
  });

  it('keeps the physics of the transition it decorates', () => {
    const staggered = staggerIn(2, 0.05, fastSpatial);
    expect(staggered.type).toBe(fastSpatial.type);
    expect(staggered.visualDuration).toBe(fastSpatial.visualDuration);
    expect(staggered.bounce).toBe(fastSpatial.bounce);
  });

  it('does not mutate the shared transition object', () => {
    // A caller-visible mutation here would poison every other consumer.
    const before = { ...defaultSpatial };
    staggerIn(5);
    expect(defaultSpatial).toEqual(before);
    expect(defaultSpatial).not.toHaveProperty('delay');
  });

  it('defaults to the standard spatial spring', () => {
    expect(staggerIn(1).visualDuration).toBe(defaultSpatial.visualDuration);
  });
});

describe('presets animate only composited properties', () => {
  const presets: Record<string, object[]> = {
    heroEnter: [heroEnter.initial, heroEnter.animate],
    heroItem: [heroItem.initial, heroItem.animate],
    rewardPop: [rewardPop],
    dismissDip: [dismissDip],
    pressStar: [pressStar],
    errorIn: [errorIn.initial, errorIn.animate],
    shuffleWiggle: [shuffleWiggle],
  };

  it.each(Object.entries(presets))('%s touches no layout property', (_name, states) => {
    const keys = states.flatMap((state) => Object.keys(state));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(COMPOSITED).toContain(key);
  });
});

describe('keyframe presets stay mutable', () => {
  /**
   * Documented trap: framer-motion needs *mutable* keyframe arrays. Freezing
   * these with `as const` type-checks under `tsc --noEmit` but breaks the
   * production build — so the arrays are deliberately not frozen.
   */
  it.each([
    ['errorIn.animate.x', errorIn.animate.x],
    ['shuffleWiggle.rotate', shuffleWiggle.rotate],
    ['shuffleWiggle.scale', shuffleWiggle.scale],
  ])('%s is a mutable array', (_name, arr) => {
    expect(Array.isArray(arr)).toBe(true);
    expect(Object.isFrozen(arr)).toBe(false);
  });
});

describe('signature keyframes keep their shape', () => {
  it('rewardPop overshoots and settles back to rest', () => {
    expect(rewardPop.scale[0]).toBeLessThan(1); // press
    expect(Math.max(...rewardPop.scale)).toBeGreaterThan(1); // pop
    expect(rewardPop.scale.at(-1)).toBe(1); // settle
    expect(rewardPop.rotate.at(-1)).toBe(0);
  });

  it('dismissDip only dips — un-favouriting is not a celebration', () => {
    expect(Math.max(...dismissDip.scale)).toBe(1);
    expect(Math.min(...dismissDip.scale)).toBeLessThan(1);
    expect(dismissDip.scale.at(-1)).toBe(1);
  });

  it('errorIn shakes around the resting position and ends on it', () => {
    const x = errorIn.animate.x as number[];
    expect(x[0]).toBe(0);
    expect(x.at(-1)).toBe(0);
    expect(x.some((v) => v < 0)).toBe(true);
    expect(x.some((v) => v > 0)).toBe(true);
  });

  it('errorIn decays instead of shaking evenly', () => {
    // A constant-amplitude shake reads as a hardware fault, not as feedback.
    const swings = (errorIn.animate.x as number[]).map(Math.abs).filter((v) => v > 0);
    expect(swings.at(-1)).toBeLessThan(swings[0]);
  });

  it('shuffleWiggle returns to the neutral pose', () => {
    expect(shuffleWiggle.rotate.at(-1)).toBe(0);
    expect(shuffleWiggle.scale.at(-1)).toBe(1);
  });

  it('hero entrances start invisible and end fully opaque', () => {
    for (const preset of [heroEnter, heroItem]) {
      expect(preset.initial.opacity).toBe(0);
      expect(preset.animate.opacity).toBe(1);
      expect(preset.animate.y).toBe(0);
    }
  });
});

describe('module surface', () => {
  it('exports no raw numeric constant that components could reach for', () => {
    // Everything public is a transition object, a preset or the stagger helper —
    // a bare number here would invite `transition={{ duration: MAGIC }}`.
    for (const [name, value] of Object.entries(tokens)) {
      expect(typeof value, `${name} should not be a bare number/string`).not.toBe('number');
    }
  });
});
