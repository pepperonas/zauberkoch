/** E2E smoke: mocked login -> generate a recipe (mocked SSE) -> favorite it.
 * All /api calls are intercepted — no backend, no Anthropic tokens.
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
    { nr: 1, titel: 'Kochen', text: 'Spaghetti bissfest kochen.', dauer_sek: 540 },
    { nr: 2, titel: 'Mischen', text: 'Alles vermengen.', dauer_sek: null },
  ],
  tipps: ['Pasta-Wasser aufheben.'],
  naehrwerte: null,
  glas: null,
  garnitur: null,
};

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const STREAM_BODY =
  sse('meta', RECIPE) +
  RECIPE.zutaten.map((z) => sse('zutat', z)).join('') +
  RECIPE.schritte.map((s) => sse('schritt', s)).join('') +
  sse('tipp', RECIPE.tipps[0]) +
  sse('done', RECIPE) +
  sse('saved', { recipe_id: 42, cached: false, remaining: 19 });

async function mockApi(page: Page) {
  const favoriteCalls: string[] = [];
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/recipes/generate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: STREAM_BODY,
    }),
  );
  await page.route('**/api/v1/recipes/42/favorite', (route) => {
    favoriteCalls.push(route.request().method());
    return route.fulfill({ json: { is_favorite: route.request().method() === 'PUT' } });
  });
  await page.route('**/api/v1/recipes?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/shopping', (route) => route.fulfill({ json: { items: [] } }));
  return favoriteCalls;
}

test('login -> generate -> favorite', async ({ page }) => {
  const favoriteCalls = await mockApi(page);

  await page.goto('/');

  // Logged in: wizard is visible (mode segmented button)
  await expect(page.getByRole('button', { name: /Kochen/ })).toBeVisible();

  // Walk the wizard: cuisine -> taste -> details -> generate
  await page.getByRole('button', { name: 'Italienisch' }).click();
  await page.getByRole('button', { name: /Weiter/ }).click();
  await page.getByRole('button', { name: 'frisch', exact: false }).click();
  await page.getByRole('button', { name: /Weiter/ }).click();
  await page.getByRole('button', { name: /Rezept zaubern/ }).click();

  // Streamed recipe renders
  await expect(page.getByRole('heading', { name: 'Pasta al Limone' })).toBeVisible();
  await expect(page.getByRole('button', { name: /250\s?g Spaghetti/ })).toBeVisible();
  await expect(page.getByText('Pasta-Wasser aufheben.')).toBeVisible();
  await expect(page.getByText(/Noch 19 Zauber heute/)).toBeVisible();

  // Favorite it
  await page.getByRole('button', { name: /Favorit/ }).click();
  await expect.poll(() => favoriteCalls).toContain('PUT');
});

test('generation survives navigation and is reachable via the pill', async ({ page }) => {
  await mockApi(page);
  // Slow stream: response arrives after 1.5s so the run is "in flight" while we navigate
  await page.unroute('**/api/v1/recipes/generate');
  await page.route('**/api/v1/recipes/generate', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: STREAM_BODY });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Italienisch' }).click();
  await page.getByRole('button', { name: /Weiter/ }).click();
  await page.getByRole('button', { name: /Weiter/ }).click();
  await page.getByRole('button', { name: /Rezept zaubern/ }).click();

  // Conjuring stage is up -> navigate away while the stream is running
  await expect(page.getByText('Der Zauberkoch schwingt den Stab …')).toBeVisible();
  await page.getByRole('link', { name: /Favoriten/ }).click();

  // Progress bar under the header + floating pill: generation kept running
  await expect(page.getByRole('progressbar', { name: /Rezept wird gezaubert/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rezept wird gezaubert/ })).toBeVisible();
  await page.getByRole('button', { name: /Dein Rezept ist fertig/ }).click();
  await expect(page.getByRole('heading', { name: 'Pasta al Limone' })).toBeVisible();
});

test('landing page for logged-out users', async ({ page }) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: 'x' } } }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mit Google anmelden' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Was kochen wir heute?' })).toBeVisible();
});

test('the footer offers GitHub, a donation and a Google review', async ({ page }) => {
  // The URLs *are* the feature — a typo turns each card into a dead end, and
  // nothing else in the suite would notice.
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto('/');

  const colophon = page.locator('.colophon');
  await expect(colophon.getByRole('link', { name: /Open Source auf GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/pepperonas/zauberkoch-pwa',
  );
  await expect(colophon.getByRole('link', { name: /Spendier einen Espresso/ })).toHaveAttribute(
    'href',
    /paypal\.com\/donate/,
  );
  const review = colophon.getByRole('link', { name: /Bewertung auf Google/ });
  await expect(review).toHaveAttribute('href', 'https://g.page/r/CXgdRV3QysvxEBM/review');
  // Leaving the app must not cost a running generation, and rel guards the tab.
  await expect(review).toHaveAttribute('target', '_blank');
  await expect(review).toHaveAttribute('rel', /noopener/);
});

test.describe('colophon genie', () => {
  const GENIE_ME = {
    authenticated: true, is_admin: false, id: 1, email: 'a@b.de', name: 'A', picture_url: '',
    adult_confirmed: true, has_password: true, own_key: { active: false, hint: '', since: null },
    csrf_token: 'x',
    preferences: { vegetarisch: false, vegan: false, glutenfrei: false, laktosefrei: false, vermeiden: [], vorraete: [], standard_personen: 2 },
  };

  async function footer(page: import('@playwright/test').Page) {
    await page.route('**/api/v1/me', (r) => r.fulfill({ json: GENIE_ME }));
    await page.route('**/api/v1/recipes?**', (r) => r.fulfill({ json: { items: [] } }));
    await page.goto('/');
    await page.locator('.colophon').scrollIntoViewIfNeeded();
  }

  test('a hovered card raises the field and leaving retracts it', async ({ page }) => {
    await footer(page);
    await expect(page.locator('.colophon--genie')).toHaveCount(0);

    await page.locator('.colophon__card--review').hover();
    await expect(page.locator('.colophon--genie')).toHaveCount(1);
    // The field is armed on visibility, so the canvas is ready before the hover.
    await expect(page.locator('.colophon__genie canvas')).toHaveCount(1);

    await page.mouse.move(5, 5);
    await expect(page.locator('.colophon--genie')).toHaveCount(0);
  });

  test('switching cards morphs instead of swapping', async ({ page }) => {
    await footer(page);

    // Alpha mass in the band where the star row lives. A hard swap would put
    // the finished figure there within a frame; a morph needs the flight time,
    // during which the dots are spread out and dim.
    const band = () =>
      page.evaluate(() => {
        const c = document.querySelector('.colophon__genie canvas') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        // The star row sits around 0.26 of the field height (see GenieField) —
        // this band has to follow it, or the test measures empty canvas.
        const y0 = Math.floor(c.height * 0.15);
        const d = ctx.getImageData(0, y0, c.width, Math.floor(c.height * 0.25)).data;
        let sum = 0;
        for (let i = 3; i < d.length; i += 4) sum += d[i];
        return Math.round(sum / 1000);
      });

    await page.locator('.colophon__card').first().hover();
    await page.waitForTimeout(1700);

    await page.locator('.colophon__card--review').hover();
    await page.waitForTimeout(150);
    const early = await band();
    await page.waitForTimeout(1300);
    const settled = await band();

    expect(settled).toBeGreaterThan(400); // the stars really did form
    expect(early).toBeLessThan(settled * 0.45); // …and they were not simply there
  });

  test('rapid switching leaves the field intact', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await footer(page);
    for (let i = 0; i < 6; i++) {
      await page.locator('.colophon__card--donate').hover();
      await page.waitForTimeout(70);
      await page.locator('.colophon__card').first().hover();
      await page.waitForTimeout(70);
    }
    await page.locator('.colophon__card--review').hover();
    await page.waitForTimeout(1400);
    const lit = await page.evaluate(() => {
      const c = document.querySelector('.colophon__genie canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let on = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) on++;
      return on;
    });
    expect(lit).toBeGreaterThan(2000); // retargeting mid-flight did not strand them
    expect(errors).toEqual([]);
  });

  test('reduced motion mounts nothing at all', async ({ page }) => {
    // Not merely "does not animate": the canvas and its chunk stay away.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await footer(page);
    await page.locator('.colophon__card--donate').hover();
    await page.waitForTimeout(600);
    await expect(page.locator('.colophon__genie canvas')).toHaveCount(0);
    await expect(page.locator('.colophon--genie')).toHaveCount(0);
  });
});
