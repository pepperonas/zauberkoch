/** Desktop layout contract.
 *
 * The app is mobile-first and the shell was a 720px column at every width. On
 * a 1512px window that used 48 % of the screen and made the recipe 4.1 screens
 * tall. Widening the container alone was measured and rejected: it saved 7 % of
 * scroll height and pushed the step text from 77 to ~125 characters per line.
 *
 * So the extra width goes to *lists*, never to prose, and three things must
 * stay true. None of them is visible in a unit test, and all three are one
 * careless CSS edit away from breaking:
 *
 *   1. below the breakpoint nothing changes at all,
 *   2. the recipe reading measure stays inside the typographic range,
 *   3. row lists (shopping, plan) keep opting out of the width.
 */

import { expect, test, type Page } from '@playwright/test';

/* This file measures geometry, not motion. The day cards and recipe sections
 * enter with a staggered spring, and reading a bounding box mid-flight yields
 * the animated position, not the laid-out one — which showed up as one test
 * passing alone and failing inside the full suite. Reduced motion skips the
 * entrances outright, so every measurement here is of the settled layout. */
test.use({ reducedMotion: 'reduce' });

const ME = {
  authenticated: true,
  is_admin: false,
  id: 1,
  email: 'alice@example.com',
  name: 'Alice',
  picture_url: '',
  adult_confirmed: true,
  csrf_token: 'test-csrf',
  preferences: { vegetarisch: false, vegan: false, glutenfrei: false, laktosefrei: false, vermeiden: [], standard_personen: 2 },
};

const RECIPE = {
  id: 42,
  titel: 'Pasta al Limone',
  teaser: 'Cremig-frische Zitronenpasta.',
  kueche: 'Italienisch',
  tags: ['pasta'],
  portionen: 2,
  zeit_aktiv: 15,
  zeit_gesamt: 20,
  schwierigkeit: 'einfach',
  zutaten: [
    { menge: 250, einheit: 'g', name: 'Spaghetti', gruppe: '' },
    { menge: 60, einheit: 'g', name: 'Parmesan', gruppe: '' },
  ],
  schritte: [
    {
      nr: 1,
      titel: 'Kochen',
      // long enough to actually wrap, otherwise the measure cannot be observed
      text: 'Spaghetti in reichlich Salzwasser bissfest kochen und dabei eine Tasse '
        + 'des stärkehaltigen Kochwassers beiseitestellen, bevor du abgießt.',
      dauer_sek: 540,
    },
  ],
  tipps: ['Pasta-Wasser aufheben.'],
  naehrwerte: null,
  glas: null,
  garnitur: null,
};

async function mockApi(page: Page) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/recipes/42', (route) =>
    route.fulfill({ json: { recipe: RECIPE, id: 42, mode: 'kochen', is_favorite: false, notiz: '', gekocht_count: 0 } }),
  );
  await page.route('**/api/v1/recipes?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/shopping', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/plan**', (route) => route.fulfill({ json: PLAN_WEEK }));
}

/** Monday–Sunday with three dishes, one of them a long title that has to clamp. */
const PLAN_WEEK = {
  start: '2026-08-10',
  days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].map(
    (datum, i) => ({
      datum,
      entries:
        i < 3
          ? [{
              id: 100 + i,
              recipe_id: 42,
              titel: i === 1 ? 'Thailändisches Massaman-Curry mit Rindfleisch' : `Gericht ${i}`,
              kueche: 'Test',
              mode: 'kochen' as const,
              tags: [],
              zeit_gesamt: 30,
            }]
          : [],
    }),
  ),
};

/** Characters per line of the widest wrapping paragraph in `selector`. */
async function measure(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`no element for ${sel}`);
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.cssText = `font:${cs.font};visibility:hidden;position:absolute;white-space:pre`;
    probe.textContent = 'x'.repeat(52);
    document.body.appendChild(probe);
    const perChar = probe.getBoundingClientRect().width / 52;
    probe.remove();
    return Math.round(el.getBoundingClientRect().width / perChar);
  }, selector);
}

const shellWidth = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector('.shell')!.getBoundingClientRect().width));

test.describe('below the breakpoint nothing changes', () => {
  for (const width of [390, 768, 1099]) {
    test(`the shell stays a single 720px column at ${width}px`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/rezept/42');
      await expect(page.locator('.recipe__zutaten')).toBeVisible();

      expect(await shellWidth(page)).toBeLessThanOrEqual(720);
      // one column: ingredients sit ABOVE the steps, not beside them
      const ing = await page.locator('.recipe__zutaten').boundingBox();
      const steps = await page.locator('.recipe__schritte').boundingBox();
      expect(ing!.y + ing!.height).toBeLessThanOrEqual(steps!.y + 1);
    });
  }

  test('1099px is still narrow and 1100px is already wide', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 1099, height: 900 });
    await page.goto('/rezept/42');
    await expect(page.locator('.recipe__zutaten')).toBeVisible();
    expect(await shellWidth(page)).toBe(720);

    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForTimeout(200);
    expect(await shellWidth(page)).toBeGreaterThan(720);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1512, height: 950 } });

  test('the recipe puts the ingredients beside the steps', async ({ page }) => {
    await mockApi(page);
    await page.goto('/rezept/42');
    await expect(page.locator('.recipe__zutaten')).toBeVisible();

    const ing = (await page.locator('.recipe__zutaten').boundingBox())!;
    const steps = (await page.locator('.recipe__schritte').boundingBox())!;
    // side by side: the ingredient column ends before the steps column starts
    expect(ing.x + ing.width).toBeLessThanOrEqual(steps.x + 1);
    // and they share a row rather than stacking
    expect(Math.abs(ing.y - steps.y)).toBeLessThan(80);
  });

  test('the step text keeps a readable measure', async ({ page }) => {
    await mockApi(page);
    await page.goto('/rezept/42');
    await expect(page.locator('.recipe__schritte')).toBeVisible();

    const chars = await measure(page, '.recipe__schritte p');
    // 45–75 is the classic range; 80 is the hard ceiling this layout must not
    // cross, since crossing it was the whole reason not to just widen the shell.
    expect(chars).toBeLessThanOrEqual(80);
    expect(chars).toBeGreaterThan(40);
  });

  test('the shopping list opts out of the extra width', async ({ page }) => {
    await mockApi(page);
    await page.goto('/einkauf');
    await expect(page.locator('.page--rows')).toBeVisible();

    const shell = await shellWidth(page);
    const row = (await page.locator('.page--rows > *').first().boundingBox())!;
    expect(shell).toBeGreaterThan(1000);
    // a row must not inherit the full width — the delete action would end up
    // hundreds of pixels away from the item it belongs to
    expect(row.width).toBeLessThanOrEqual(800);
  });

  test('no view scrolls sideways', async ({ page }) => {
    await mockApi(page);
    for (const path of ['/', '/rezept/42', '/verlauf', '/favoriten', '/einkauf', '/plan']) {
      await page.goto(path);
      await page.waitForTimeout(400);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, `${path} scrolls sideways`).toBe(false);
    }
  });
});

/* ── The weekly planner ───────────────────────────────────────────────────
   A week view exists to show a week. Stacked as seven rows it ran 1716px at
   1512px wide, so Sunday sat below the fold — the one thing the layout was
   supposed to make visible was the thing you had to scroll for.

   Its breakpoint is 1240px rather than the app's 1100px: seven columns need
   roughly 150px each to hold a wrapped dish title, and below that they are
   more cramped than the rows they replace. */

test.describe('weekly planner', () => {
  test('stays a stack of rows below 1240px', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 1239, height: 900 });
    await page.goto('/plan');
    await expect(page.locator('.plan__day').first()).toBeVisible();

    const boxes = await page.locator('.plan__day').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().y)),
    );
    expect(new Set(boxes).size).toBe(7); // seven distinct rows
  });

  test('shows all seven days side by side from 1240px', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 1240, height: 900 });
    await page.goto('/plan');
    await expect(page.locator('.plan__day').first()).toBeVisible();

    // Retried until the layout settles rather than measured once. `reducedMotion`
    // is honoured only after `useReducedMotion()` has read the media query, so
    // the first paint can still carry the staggered entrance offset — measuring
    // into that window made this fail about half the time on a correct layout.
    // Grid tracks also land on sub-pixel boundaries, hence a 2px tolerance
    // instead of exact equality.
    await expect(async () => {
      const boxes = await page.locator('.plan__day').evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).map((b) => ({ y: b.y, h: b.height })),
      );
      expect(boxes).toHaveLength(7);
      const spread = (ns: number[]) => Math.max(...ns) - Math.min(...ns);
      expect(spread(boxes.map((b) => b.y)), 'all seven share one row').toBeLessThan(2);
      expect(spread(boxes.map((b) => b.h)), 'equal height, as a calendar has').toBeLessThan(2);
    }).toPass({ timeout: 5000 });
  });

  test('the whole week fits on one screen', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.goto('/plan');
    await expect(page.locator('.plan__day').first()).toBeVisible();

    await expect(async () => {
      const sunday = (await page.locator('.plan__day').last().boundingBox())!;
      expect(sunday.y + sunday.height).toBeLessThanOrEqual(950);
    }).toPass({ timeout: 5000 });
  });

  test('a clamped title keeps the full name reachable', async ({ page }) => {
    // Three lines is all a 150px column gets, so the rest lives in the tooltip
    // and in the accessible name — never nowhere.
    await mockApi(page);
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.goto('/plan');

    const long = page.locator('.plan-entry__open').nth(1);
    await expect(long).toHaveAttribute('title', 'Thailändisches Massaman-Curry mit Rindfleisch');
    await expect(long).toHaveAttribute('aria-label', /Thailändisches Massaman-Curry mit Rindfleisch/);
  });

  test('the delete button stays inside its day card', async ({ page }) => {
    // It is absolutely placed in the grid; a wrong offset would hang it over
    // the neighbouring day.
    await mockApi(page);
    await page.setViewportSize({ width: 1240, height: 900 });
    await page.goto('/plan');
    await expect(page.locator('.plan__day').first()).toBeVisible();

    const card = (await page.locator('.plan__day').first().boundingBox())!;
    const remove = (await page.locator('.plan-entry__remove').first().boundingBox())!;
    expect(remove.x + remove.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    expect(remove.x).toBeGreaterThanOrEqual(card.x - 0.5);
  });
});
