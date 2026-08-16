/** Direction-aware tab transitions — the stamp contract.
 *
 * The whole feature hangs on one attribute: `data-tab-dir` on <html> selects
 * the slide direction AND scopes the view-transition-names of title, tools
 * and generation pill. Its lifecycle is therefore the thing to pin:
 *
 *   - a bottom-nav click stamps it before the snapshot,
 *   - it is gone again once the transition is over,
 *   - a card→detail navigation clears it — a leaked stamp would slide the
 *     container-transform morph sideways and attach names the detail page
 *     must never carry.
 *
 * Uniqueness matters just as much: two elements sharing a view-transition-name
 * in one snapshot abort the ENTIRE transition, silently. Hence the per-page
 * checks that title and tools exist exactly once.
 */

import { expect, test, type Page } from '@playwright/test';

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
  zutaten: [{ menge: 250, einheit: 'g', name: 'Spaghetti', gruppe: '' }],
  schritte: [{ nr: 1, titel: 'Kochen', text: 'Spaghetti bissfest kochen.', dauer_sek: 540 }],
  tipps: [],
  naehrwerte: null,
  glas: null,
  garnitur: null,
};

const LIST_ITEM = {
  id: 42, titel: RECIPE.titel, teaser: RECIPE.teaser, kueche: RECIPE.kueche, mode: 'kochen',
  tags: RECIPE.tags, zeit_gesamt: 20, schwierigkeit: 'einfach', glas: null, is_favorite: true,
  gericht_typ: '', created_at: '2026-08-16T10:00:00Z',
};

async function mockApi(page: Page) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/recipes/42', (route) =>
    route.fulfill({ json: { recipe: RECIPE, id: 42, mode: 'kochen', is_favorite: false, notiz: '', gekocht_count: 0 } }),
  );
  // two patterns: the filterless list is the bare URL — no '?', so the
  // glob with a query tail never matches it
  await page.route('**/api/v1/recipes', (route) => route.fulfill({ json: { items: [LIST_ITEM] } }));
  await page.route('**/api/v1/recipes?**', (route) => route.fulfill({ json: { items: [LIST_ITEM] } }));
  await page.route('**/api/v1/shopping', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/plan**', (route) => route.fulfill({ json: { start: '2026-08-10', days: [] } }));
}

const stamp = (page: Page) => page.evaluate(() => document.documentElement.dataset.tabDir ?? null);

test('a forward tab switch stamps fwd and retires the stamp', async ({ page }) => {
  await mockApi(page);
  await page.goto('/verlauf');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();

  await page.getByRole('link', { name: 'Einkauf' }).click();

  expect(await stamp(page)).toBe('fwd');
  await expect.poll(() => stamp(page), { timeout: 2000 }).toBeNull();
  await expect(page).toHaveURL(/\/einkauf$/);
});

test('a backward tab switch stamps back', async ({ page }) => {
  await mockApi(page);
  await page.goto('/plan');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();

  await page.getByRole('link', { name: 'Favoriten' }).click();

  expect(await stamp(page)).toBe('back');
});

test('re-clicking the active tab leaves no stamp', async ({ page }) => {
  await mockApi(page);
  await page.goto('/verlauf');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();

  await page.getByRole('link', { name: 'Verlauf' }).click();

  expect(await stamp(page)).toBeNull();
});

test('a card click right after a tab switch clears the stamp before the morph', async ({ page }) => {
  // The dangerous window: tab click stamps for 650ms, and a fast hand reaches
  // a recipe card inside it. The detail morph must not inherit the slide.
  await mockApi(page);
  await page.goto('/verlauf');
  await expect(page.locator('.recipecard').first()).toBeVisible();

  await page.getByRole('link', { name: 'Favoriten' }).click();
  await page.locator('.recipecard').first().click();

  expect(await stamp(page)).toBeNull();
  await expect(page).toHaveURL(/\/rezept\/42$/);
});

test('title and tools exist exactly once per tab page', async ({ page }) => {
  // A second element with the same view-transition-name aborts the whole
  // transition without an error — this is the only guard against that.
  // VISIBLE elements only: the off-route detail prewarm keeps a hidden
  // `.page__title` error paragraph in the DOM, and display:none subtrees are
  // excluded from view-transition capture, so they cannot collide.
  await mockApi(page);
  for (const path of ['/favoriten', '/verlauf', '/einkauf', '/plan']) {
    await page.goto(path);
    await expect(page.locator('.page__title').locator('visible=true')).toHaveCount(1);
    await expect(page.locator('.page-tools').locator('visible=true')).toHaveCount(1);
  }
});

test('the wizard has neither name — its unpaired fallback is the contract', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Überrasch mich/ })).toBeVisible();
  await expect(page.locator('.page__title').locator('visible=true')).toHaveCount(0);
  await expect(page.locator('.page-tools').locator('visible=true')).toHaveCount(0);
});

test('reduced motion: tab switches still navigate, nothing lingers', async ({ page, context }) => {
  void context;
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/verlauf');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();

  await page.getByRole('link', { name: 'Einkauf' }).click();

  await expect(page).toHaveURL(/\/einkauf$/);
  await expect.poll(() => stamp(page), { timeout: 2000 }).toBeNull();
});

test.describe('cross-tab card morphs', () => {
  test('cards are named for the tab switch and stripped afterwards', async ({ page }) => {
    await mockApi(page);
    await page.goto('/favoriten');
    await expect(page.locator('.recipecard').first()).toBeVisible();

    await page.getByRole('link', { name: 'Verlauf' }).click();

    // the OLD-side naming happened in the click handler; on the new page the
    // render-time naming applies while the stamp lives
    await expect
      .poll(async () =>
        page.evaluate(
          () => [...document.querySelectorAll('.recipecard')].filter((n) => (n as HTMLElement).style.viewTransitionName).length,
        ),
      )
      .toBeGreaterThan(0);

    // and NOTHING may survive the stamp: a lingering name would ride into the
    // next card→detail morph as an extra snapshot layer — the perf trap the
    // "only the clicked card is named" rule exists for
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => [...document.querySelectorAll('.recipecard')].filter((n) => (n as HTMLElement).style.viewTransitionName).length,
          ),
        { timeout: 2500 },
      )
      .toBe(0);
  });

  test('a detail morph right after a tab switch carries zero card layers', async ({ page }) => {
    await mockApi(page);
    await page.goto('/favoriten');
    await expect(page.locator('.recipecard').first()).toBeVisible();

    await page.getByRole('link', { name: 'Verlauf' }).click();
    await page.waitForTimeout(150); // inside the stamp's lifetime
    await page.locator('.recipecard').first().click();

    // clearTabTransition() in open() runs synchronously before navigate:
    // stamp gone, names gone — BEFORE the detail snapshot is taken
    expect(await stamp(page)).toBeNull();
    const named = await page.evaluate(
      () => [...document.querySelectorAll('.recipecard')].filter((n) => (n as HTMLElement).style.viewTransitionName).length,
    );
    expect(named).toBe(0);
    await expect(page).toHaveURL(/\/rezept\/42$/);
  });
});
