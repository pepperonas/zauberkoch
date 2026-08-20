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

/** Record every value `data-tab-dir` ever takes, from before the click.
 *
 * Reading the attribute back after `.click()` resolves is a RACE, and it bit:
 * the stamp is deliberately short-lived (TAB_DIR_TTL_MS = 650 ms), and on a
 * loaded machine the extra round-trip can land after the shell has already
 * retired it — the assertion then sees null for a perfectly correct stamp.
 * Two of these flaked. An observer installed beforehand cannot miss it, and it
 * also closes the opposite hole: a WRONGLY set stamp that the TTL cleans up
 * before the read would otherwise pass as "no stamp".
 */
async function recordStamps(page: Page) {
  await page.evaluate(() => {
    const log: (string | null)[] = [];
    (window as unknown as { __stamps: (string | null)[] }).__stamps = log;
    const el = document.documentElement;
    new MutationObserver(() => log.push(el.dataset.tabDir ?? null)).observe(el, {
      attributes: true,
      attributeFilter: ['data-tab-dir'],
    });
  });
}
const stamps = (page: Page) =>
  page.evaluate(() => (window as unknown as { __stamps: (string | null)[] }).__stamps);

test('a forward tab switch stamps fwd and retires the stamp', async ({ page }) => {
  await mockApi(page);
  await page.goto('/verlauf');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();
  await recordStamps(page);

  await page.getByRole('link', { name: 'Einkauf' }).click();

  expect(await stamps(page)).toContain('fwd');
  await expect.poll(() => stamp(page), { timeout: 2000 }).toBeNull();
  await expect(page).toHaveURL(/\/einkauf$/);
});

test('a backward tab switch stamps back', async ({ page }) => {
  await mockApi(page);
  await page.goto('/plan');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();
  await recordStamps(page);

  await page.getByRole('link', { name: 'Favoriten' }).click();

  expect(await stamps(page)).toContain('back');
});

test('re-clicking the active tab leaves no stamp', async ({ page }) => {
  await mockApi(page);
  await page.goto('/verlauf');
  await expect(page.locator('.page__title').locator('visible=true')).toBeVisible();
  await recordStamps(page);

  await page.getByRole('link', { name: 'Verlauf' }).click();

  // Not "is null now" — that is also true 650 ms after a wrong stamp. Nothing
  // may have been stamped at any point.
  expect(await stamps(page)).not.toContain('fwd');
  expect(await stamps(page)).not.toContain('back');
  expect(await stamp(page)).toBeNull();
});

test('a card click right after a tab switch clears the stamp before the morph', async ({ page }) => {
  // The dangerous window: tab click stamps for 650ms, and a fast hand reaches
  // a recipe card inside it. The detail morph must not inherit the slide.
  await mockApi(page);
  await page.goto('/verlauf');
  await expect(page.locator('.recipecard').first()).toBeVisible();
  await recordStamps(page);

  await page.getByRole('link', { name: 'Favoriten' }).click();
  await page.locator('.recipecard').first().click();

  // The recorder proves we really were inside the dangerous window (a stamp
  // was set), so "null now" means the card click cleared it — not that the
  // tab click never stamped in the first place.
  expect(await stamps(page)).toContain('back');
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
  /** Log every card that ever carries a view-transition-name.
   *
   *  Polling for "some card is named right now" is a race with a ~650 ms
   *  window and it lost under load: the first poll can land after the names
   *  are already stripped, and then it never sees them. An observer installed
   *  before the click records the fact instead of trying to catch it. */
  async function recordNamedCards(page: Page) {
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __named: Set<string> }).__named = seen;
      const scan = () => {
        for (const n of document.querySelectorAll<HTMLElement>('.recipecard'))
          if (n.style.viewTransitionName) seen.add(n.style.viewTransitionName);
      };
      // childList too: the incoming page's cards are NEW elements that arrive
      // with the name already on them, which is not an attribute mutation.
      new MutationObserver(scan).observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['style'],
      });
    });
  }
  const namedCards = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { __named: Set<string> }).__named]);
  const namedNow = (page: Page) =>
    page.evaluate(
      () => [...document.querySelectorAll('.recipecard')].filter((n) => (n as HTMLElement).style.viewTransitionName).length,
    );

  test('cards are named for the tab switch and stripped afterwards', async ({ page }) => {
    await mockApi(page);
    await page.goto('/favoriten');
    await expect(page.locator('.recipecard').first()).toBeVisible();
    await recordNamedCards(page);

    await page.getByRole('link', { name: 'Verlauf' }).click();

    // Both sides name the same recipe — that pairing IS the morph.
    expect(await namedCards(page)).toContain('zk-card-42');

    // And NOTHING may survive the stamp: a lingering name would ride into the
    // next card→detail morph as an extra snapshot layer — the perf trap the
    // "only the clicked card is named" rule exists for. Settling to zero is
    // monotone, so polling for it is safe.
    await expect.poll(() => namedNow(page), { timeout: 2500 }).toBe(0);
  });

  test('a detail morph right after a tab switch carries zero card layers', async ({ page }) => {
    await mockApi(page);
    await page.goto('/favoriten');
    await expect(page.locator('.recipecard').first()).toBeVisible();

    // Snapshot the named elements AT the moment the browser takes the view
    // transition snapshot — checking afterwards would be near-vacuous, because
    // by then the list has unmounted and there are no cards left to be named.
    await page.evaluate(() => {
      const w = window as unknown as { __vtNames: string[][]; };
      w.__vtNames = [];
      const doc = document as unknown as { startViewTransition?: (cb: () => unknown) => unknown };
      const orig = doc.startViewTransition?.bind(document);
      if (!orig) return;
      doc.startViewTransition = (cb: () => unknown) => {
        w.__vtNames.push(
          [...document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')]
            .map((n) => n.style.viewTransitionName)
            .filter(Boolean),
        );
        return orig(cb);
      };
    });

    await page.getByRole('link', { name: 'Verlauf' }).click();
    await page.waitForTimeout(150); // inside the stamp's lifetime
    await page.locator('.recipecard').first().click();
    await expect(page).toHaveURL(/\/rezept\/42$/);

    const runs = await page.evaluate(() => (window as unknown as { __vtNames: string[][] }).__vtNames);
    const detail = runs.at(-1) ?? [];
    // The detail morph names exactly the hero pair — no inherited card layers.
    expect(detail.filter((n) => n.startsWith('zk-card-'))).toEqual([]);
    expect(detail).toContain('zk-shared-motif');
  });
});
