/** Fridge/pantry autocomplete: catalogue integrity + search behaviour. */

import { describe, expect, it } from 'vitest';

import {
  ALLE_ZUTATEN,
  TOP_ZUTATEN,
  ZUTAT_KATEGORIEN,
  foldZutat,
  matchZutaten,
} from './zutatKatalog';

describe('catalogue integrity', () => {
  it('is substantial and grouped', () => {
    expect(ZUTAT_KATEGORIEN.length).toBeGreaterThanOrEqual(8);
    expect(ALLE_ZUTATEN.length).toBeGreaterThanOrEqual(230);
    for (const cat of ZUTAT_KATEGORIEN) {
      expect(cat.name).not.toBe('');
      expect(cat.items.length).toBeGreaterThan(10);
    }
  });

  it('has no duplicates (fold-insensitive) and no stray whitespace', () => {
    const seen = new Map<string, string>();
    for (const item of ALLE_ZUTATEN) {
      expect(item).toBe(item.trim());
      const key = foldZutat(item);
      expect(seen.has(key), `duplicate: ${item} vs ${seen.get(key)}`).toBe(false);
      seen.set(key, item);
    }
  });

  it('top suggestions all exist in the catalogue', () => {
    const all = new Set(ALLE_ZUTATEN.map(foldZutat));
    // 'Käse' is a deliberate generic staple; everything else must be catalogued
    for (const top of TOP_ZUTATEN) {
      if (foldZutat(top) === 'kaese') continue;
      expect(all.has(foldZutat(top)), `not in catalogue: ${top}`).toBe(true);
    }
    expect(new Set(TOP_ZUTATEN).size).toBe(TOP_ZUTATEN.length); // deduped
  });
});

describe('foldZutat', () => {
  it('folds umlauts the German way and strips diacritics', () => {
    expect(foldZutat('Möhre')).toBe('moehre');
    expect(foldZutat('Süßkartoffel')).toBe('suesskartoffel');
    expect(foldZutat('Crème fraîche')).toBe('creme fraiche');
    expect(foldZutat('Jalapeño')).toBe('jalapeno');
  });
});

describe('matchZutaten', () => {
  it('shows staples on an empty query', () => {
    const hits = matchZutaten('');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('Ei');
  });

  it('ranks prefix matches before substring matches', () => {
    const hits = matchZutaten('kar');
    // both start with "kar" -> catalogue order among prefix hits
    expect(hits.slice(0, 2)).toEqual(['Kartoffel', 'Karotte']);
    // a substring-only match must rank after every prefix hit
    const zucker = matchZutaten('uck');
    expect(zucker).toContain('Zucker');
    const gemischt = matchZutaten('ei');
    const prefixIdx = gemischt.findIndex((z) => foldZutat(z).startsWith('ei'));
    const substrIdx = gemischt.findIndex((z) => !foldZutat(z).startsWith('ei'));
    if (prefixIdx !== -1 && substrIdx !== -1) expect(prefixIdx).toBeLessThan(substrIdx);
  });

  it('finds entries typed without umlauts', () => {
    expect(matchZutaten('moehre')).toContain('Möhre');
    expect(matchZutaten('kuerbis')).toContain('Kürbis');
    expect(matchZutaten('creme fra')).toContain('Crème fraîche');
    expect(matchZutaten('jalapeno')).toContain('Jalapeño');
  });

  it('never suggests what is already picked', () => {
    expect(matchZutaten('tomate')).toContain('Tomate');
    expect(matchZutaten('tomate', ['TOMATE'])).not.toContain('Tomate');
    expect(matchZutaten('', ['Ei'])).not.toContain('Ei');
  });

  it('respects the limit and returns nothing for gibberish', () => {
    expect(matchZutaten('e', [], 3).length).toBe(3);
    expect(matchZutaten('xyzzyx')).toEqual([]);
  });
});
