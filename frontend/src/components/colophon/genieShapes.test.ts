// @vitest-environment happy-dom
/** Guards on the shape registry.
 *
 * The rasterizer itself needs a real 2D context (happy-dom has none), so what
 * is worth pinning here is the wiring around it: a missing entry would size a
 * figure to NaN, and a browser without canvas support must degrade to "no
 * dots" rather than throwing inside a hover handler.
 */
import { describe, expect, it } from 'vitest';

import { fieldPoints, prewarmFields, SHAPE_FILL, type GenieShapeKey } from './genieShapes';

const KEYS: GenieShapeKey[] = ['github', 'donate', 'review', 'share'];

describe('genie shapes', () => {
  it('has a fill factor for every figure', () => {
    for (const key of KEYS) {
      expect(SHAPE_FILL[key], key).toBeGreaterThan(0);
      expect(SHAPE_FILL[key], key).toBeLessThanOrEqual(1.5);
    }
    expect(Object.keys(SHAPE_FILL).sort()).toEqual([...KEYS].sort());
  });

  it('gives the flat star row more width than the tall figures', () => {
    expect(SHAPE_FILL.review).toBeGreaterThan(SHAPE_FILL.github);
  });

  it('keeps the paper plane the smallest figure', () => {
    // Counter-intuitive but measured on screen: a long diagonal reads much
    // larger than its bounding box, and at the octocat's fill factor the dart
    // spanned the whole field with its nose off the top edge. The pin exists
    // because "make it as big as the others" is exactly the wrong instinct here.
    expect(SHAPE_FILL.share).toBeLessThan(SHAPE_FILL.github);
  });

  it('returns no points instead of throwing without a 2D context', () => {
    for (const key of KEYS) expect(fieldPoints(key)).toEqual([]);
    expect(() => prewarmFields()).not.toThrow();
  });
});
