/** Das Google-Profilbild oben rechts.
 *
 * Der Fall, der hier wirklich zaehlt, ist der FEHLSCHLAG: Google-Avatar-URLs
 * verrotten (Foto gewechselt, Ratenbegrenzung), und ohne Rueckfall malt der
 * Browser sein Kaputt-Symbol samt Alt-Text aus dem Knopf heraus — genau so
 * reproduziert am 2026-09-24, bevor `onError` da war.
 */

import { expect, test, type Page } from '@playwright/test';

const ME = (picture_url: string) => ({
  authenticated: true, is_admin: false, id: 1, email: 'alice@example.com', name: 'Alice Beispiel',
  picture_url, adult_confirmed: true, has_password: true,
  own_key: { active: false, hint: '', since: null }, csrf_token: 'test-csrf',
  preferences: { vegetarisch: false, vegan: false, glutenfrei: false, laktosefrei: false,
    vermeiden: [], vorraete: [], standard_personen: 2 },
});

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocBeispiel=s96-c';

async function shell(page: Page, picture_url: string) {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: ME(picture_url) }));
  await page.route('**/api/v1/recipes', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/recipes?**', (r) => r.fulfill({ json: { items: [] } }));
}

test('ein kaputtes Profilbild weicht dem Nutzer-Glyph', async ({ page }) => {
  await shell(page, GOOGLE);
  // Das Bild scheitert, wie es in der Wirklichkeit scheitert: Googles Antwort
  // ist kein Bild.
  await page.route('**/lh3.googleusercontent.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');

  await expect(page.locator('img.avatar')).toHaveCount(0);
  const profil = page.getByRole('button', { name: /Profil/ }).first();
  await expect(profil.locator('svg')).toHaveCount(1); // das Glyph, nicht die Ruine
});

test('ein ladbares Profilbild bleibt stehen und traegt keinen zweiten Namen', async ({ page }) => {
  await shell(page, GOOGLE);
  const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('**/lh3.googleusercontent.com/**', (r) =>
    r.fulfill({ contentType: 'image/png', body: PIXEL }));
  await page.goto('/');

  const img = page.locator('img.avatar');
  await expect(img).toHaveCount(1);
  // Der Knopf traegt bereits aria-label; ein alt-Text waere ein zweiter Name —
  // und genau das, was beim Fehlschlag sichtbar aus dem Knopf lief.
  await expect(img).toHaveAttribute('alt', '');
});

test('die angefragte Bildgroesse folgt der Pixeldichte', async ({ browser }) => {
  // Der Grund der Aenderung: Googles Standard-s96 ist auf einem DPR-3-Geraet
  // ein Hochskalieren des 34-px-Platzes (102 Geraetepixel) und sichtbar weicher.
  const ctx = await browser.newContext({ deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await shell(page, GOOGLE);
  await page.goto('/');
  await expect(page.locator('img.avatar')).toHaveAttribute('src', /=s102-c$/);
  await ctx.close();
});

test('Markup und CSS sind sich ueber die Groesse einig', async ({ page }) => {
  // Ein Auseinanderlaufen waere unsichtbar: das Bild saehe richtig aus und
  // waere trotzdem in der falschen Aufloesung angefragt.
  await shell(page, GOOGLE);
  await page.goto('/');
  const masse = await page.locator('img.avatar').evaluate((el: HTMLImageElement) => ({
    attribut: el.getAttribute('width'),
    gerendert: Math.round(el.getBoundingClientRect().width),
    hoehe: Math.round(el.getBoundingClientRect().height),
  }));
  expect(masse.gerendert).toBe(Number(masse.attribut));
  expect(masse.hoehe).toBe(Number(masse.attribut));
});
