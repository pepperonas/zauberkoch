/** Icon registry sanity — every name renders, no accidental removals. */

import { describe, expect, it } from 'vitest';

import { GLYPHS } from './glyphs';

// The full contract: components reference these names statically, so a
// removed/renamed glyph must fail here before it fails in production.
const EXPECTED = [
  // brand
  'logo', 'wand',
  // magic & status
  'sparkles', 'warning', 'check', 'checkCircle', 'close', 'plus', 'ban', 'snooze', 'party', 'wifiOff',
  // navigation & shell
  'calendar', 'star', 'starOff', 'history', 'cart', 'sun', 'moon', 'shield', 'user', 'power',
  // actions
  'share', 'qr', 'chevronRight', 'chevronDown',
  'copy', 'download', 'print', 'key', 'link', 'edit', 'settings', 'camera', 'trash', 'broom', 'mic', 'dice',
  'gift', 'ticket', 'heart', 'mail', 'tools', 'thumbUp', 'thumbDown', 'image', 'note',
  // kitchen & bar
  'chefhat', 'pan', 'cocktail', 'glass', 'plate', 'herb', 'bulb',
  // meta stats
  'clock', 'timer', 'gauge',
  // regions
  'globe', 'landmark', 'dome', 'compass',
] as const;

describe('icon registry', () => {
  it('contains exactly the expected glyphs', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([...EXPECTED].sort());
  });

  it('every glyph renders an element', () => {
    for (const name of EXPECTED) {
      const el = GLYPHS[name]();
      expect(el, name).toBeTruthy();
      expect(typeof el, name).toBe('object');
    }
  });
});
