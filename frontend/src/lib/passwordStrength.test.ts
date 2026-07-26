import { describe, expect, it } from 'vitest';

import { MIN_PASSWORD_LENGTH, passwordStrength } from './passwordStrength';

describe('passwordStrength', () => {
  it('rejects empty and too-short passwords', () => {
    expect(passwordStrength('')).toEqual({ level: 0, acceptable: false });
    expect(passwordStrength('Ab1!')).toEqual({ level: 1, acceptable: false });
    expect('short'.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  });

  it('requires at least two character classes at the minimum length', () => {
    // 8 chars but a single class -> not acceptable
    expect(passwordStrength('abcdefgh')).toEqual({ level: 1, acceptable: false });
    // 8 chars, two classes -> acceptable, level 2
    expect(passwordStrength('abcdefg1')).toEqual({ level: 2, acceptable: true });
  });

  it('rewards length and class diversity', () => {
    expect(passwordStrength('Abcdefg123').level).toBe(3); // 3 classes, ≥10
    expect(passwordStrength('Abcdefg123!!').level).toBe(4); // 4 classes, ≥12
    expect(passwordStrength('Abcdefg123!!').acceptable).toBe(true);
  });

  it('a long but single-class password is still unacceptable', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa')).toEqual({ level: 1, acceptable: false });
  });
});
