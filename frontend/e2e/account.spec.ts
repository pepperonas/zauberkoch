/** E2E: data export + account deletion in the profile sheet, and the print
 * view of a recipe. All /api calls are intercepted — no backend involved.
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
  has_password: true,
  csrf_token: 'test-csrf',
  preferences: {
    vegetarisch: false,
    vegan: false,
    glutenfrei: false,
    laktosefrei: false,
    vermeiden: [],
    vorraete: [],
    standard_personen: 2,
  },
};

async function login(page: Page, me: Record<string, unknown> = ME) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: me }));
  await page.route('**/api/v1/recipes?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: /Profil/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Mein Profil' })).toBeVisible();
}

test('export downloads a JSON file', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/me/export', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-disposition': 'attachment; filename="zauberkoch-export-2026-07-27.json"' },
      body: JSON.stringify({ export_version: 1, konto: { email: 'alice@example.com' } }),
    }),
  );

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Alle meine Daten herunterladen/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('zauberkoch-export-');
});

test('deleting the account asks for the password and sends confirm', async ({ page }) => {
  await login(page);

  let body: Record<string, unknown> | null = null;
  await page.route('**/api/v1/me', async (route) => {
    if (route.request().method() === 'DELETE') {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ json: ME });
  });

  await page.getByRole('button', { name: /^Konto löschen/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Konto wirklich löschen?' });
  await expect(dlg).toBeVisible();
  // Irreversible action: the consequences are spelled out before the button.
  await expect(page.getByText(/nicht rückgängig/)).toBeVisible();

  await page.getByLabel(/Zur Sicherheit dein Passwort/).fill('geheim123');
  await page.getByRole('button', { name: /Endgültig löschen/ }).click();

  await expect.poll(() => body).not.toBeNull();
  expect(body).toEqual({ confirm: true, password: 'geheim123' });
});

test('google-only accounts are not asked for a password', async ({ page }) => {
  await login(page, { ...ME, has_password: false });
  await page.getByRole('button', { name: /^Konto löschen/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Konto wirklich löschen?' });
  await expect(dlg).toBeVisible();
  await expect(page.getByLabel(/Zur Sicherheit dein Passwort/)).toHaveCount(0);
});

test('print view hides the app chrome and keeps the recipe', async ({ page }) => {
  const RECIPE = {
    id: 42,
    titel: 'Pasta al Limone',
    teaser: 'Cremig-frische Zitronenpasta.',
    kueche: 'Italienisch',
    mode: 'kochen',
    tags: ['pasta'],
    portionen: 2,
    zeit_aktiv: 15,
    zeit_gesamt: 20,
    schwierigkeit: 'einfach',
    zutaten: [{ menge: 250, einheit: 'g', name: 'Spaghetti', gruppe: '' }],
    schritte: [{ nr: 1, titel: 'Kochen', text: 'Spaghetti bissfest kochen.', dauer_sek: 540 }],
    tipps: ['Pasta-Wasser aufheben.'],
    naehrwerte: null,
    glas: null,
    garnitur: null,
  };
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/recipes/42*', (route) =>
    route.fulfill({
      json: {
        id: 42,
        mode: 'kochen',
        recipe: RECIPE,
        is_favorite: false,
        public_listed: false,
        shared: false,
        feedback: null,
        notiz: '',
        gekocht_count: 0,
        created_at: '2026-07-27T10:00:00Z',
      },
    }),
  );
  await page.goto('/rezept/42');
  await expect(page.getByRole('heading', { name: 'Pasta al Limone' })).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  // The recipe itself survives...
  await expect(page.getByRole('heading', { name: 'Pasta al Limone' })).toBeVisible();
  await expect(page.getByText('Spaghetti bissfest kochen.')).toBeVisible();
  // ...the app around it does not.
  await expect(page.locator('.shell__header')).toBeHidden();
  await expect(page.locator('nav.nav')).toBeHidden();
  await expect(page.locator('.shell__footer')).toBeHidden();
  await expect(page.getByRole('button', { name: /Drucken/ })).toBeHidden();

  // Dark theme must not bleed onto paper.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
});

test('own Anthropic key: stored, shown masked, removable', async ({ page }) => {
  const KEY = 'sk-ant-api03-' + 'A'.repeat(60);
  let sent: string | null = null;
  let active = false;

  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { ...ME, own_key: { active, hint: active ? KEY.slice(-4) : '', since: null } } }),
  );
  await page.route('**/api/v1/me/anthropic-key', async (route) => {
    if (route.request().method() === 'PUT') {
      sent = (route.request().postDataJSON() as { key: string }).key;
      active = true;
      return route.fulfill({ json: { active: true, hint: KEY.slice(-4), since: null } });
    }
    active = false;
    return route.fulfill({ json: { active: false, hint: '', since: null } });
  });
  await page.route('**/api/v1/recipes?**', (route) => route.fulfill({ json: { items: [] } }));

  await page.goto('/');
  await page.getByRole('button', { name: /Profil/ }).first().click();
  await page.getByLabel('API-Schlüssel').fill(KEY);
  await page.getByRole('button', { name: 'Schlüssel speichern' }).click();

  // The key goes out once and the field is cleared — it never comes back.
  await expect.poll(() => sent).toBe(KEY);
  await expect(page.getByText(/Aktiv · endet auf AAAA/)).toBeVisible();
  await expect(page.getByLabel('API-Schlüssel')).toHaveCount(0);

  await page.getByRole('button', { name: /Schlüssel entfernen/ }).click();
  await expect(page.getByLabel('API-Schlüssel')).toBeVisible();
});
