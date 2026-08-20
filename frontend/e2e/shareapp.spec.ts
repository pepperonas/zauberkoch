/** E2E: "App teilen" — the two ways out of the dialog, from both entry points.
 *
 * The load-bearing assertion is the last one: Chrome's own BarcodeDetector
 * reads the rendered SVG and must come back with the URL the copy button puts
 * on the clipboard. A QR that encodes the wrong thing still looks exactly like
 * a QR, so nothing short of decoding it is evidence — the unit suite proves
 * the bits, this proves a real scanner agrees with them.
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
    vegetarisch: false, vegan: false, glutenfrei: false, laktosefrei: false,
    vermeiden: [], vorraete: [], standard_personen: 2,
  },
};

const APP_URL = 'https://zauberkoch.de';

async function login(page: Page) {
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/recipes', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/recipes?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/');
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Zauberkoch teilen' });

test('opens from the profile sheet and copies the link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);

  await page.getByRole('button', { name: /Profil/ }).first().click();
  await page.getByRole('button', { name: 'App teilen' }).click();

  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: /^Link kopieren/ }).click();

  await expect(page.getByText('Link kopiert!')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(APP_URL);
});

test('opens from the footer card', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /App weiterempfehlen/ }).click();
  await expect(dialog(page)).toBeVisible();
});

test('the QR row is a toggle, and the link stays reachable while it is open', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /App weiterempfehlen/ }).click();

  const qrRow = page.getByRole('button', { name: /QR-Code/ });
  await expect(qrRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('svg.qrcode')).toHaveCount(0);

  await qrRow.click();
  await expect(page.locator('svg.qrcode')).toBeVisible();
  await expect(qrRow).toHaveAttribute('aria-expanded', 'true');
  // Expanding must not push the other option out of the dialog: after a failed
  // scan the copy row has to still be there, not behind a "back" step.
  await expect(page.getByRole('button', { name: /^Link kopieren/ })).toBeVisible();

  await qrRow.click();
  await expect(page.locator('svg.qrcode')).toHaveCount(0);
});

test('the rendered QR decodes to the app URL', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /App weiterempfehlen/ }).click();
  await page.getByRole('button', { name: /QR-Code/ }).click();
  await expect(page.locator('svg.qrcode')).toBeVisible();

  const decoded = await page.evaluate(async () => {
    // @ts-expect-error — BarcodeDetector is Chromium-only and not in lib.dom
    if (typeof BarcodeDetector === 'undefined') return 'NO_DETECTOR';
    const svg = document.querySelector('svg.qrcode')!;
    // Rasterize at a generous size: a detector needs several device pixels per
    // module, and the on-screen 232px is close to the practical floor.
    const src = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.width = 600;
    img.height = 600;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(src)));
    });
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 600, 600);
    ctx.drawImage(img, 0, 0, 600, 600);
    // @ts-expect-error — see above
    const results = await new BarcodeDetector({ formats: ['qr_code'] }).detect(canvas);
    return results[0]?.rawValue ?? 'NO_RESULT';
  });

  expect(decoded, 'Chrome could not read our own QR code').toBe(APP_URL);
});

test('reduced motion: the QR still opens, without the height animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.getByRole('button', { name: /App weiterempfehlen/ }).click();
  await page.getByRole('button', { name: /QR-Code/ }).click();
  await expect(page.locator('svg.qrcode')).toBeVisible();
});

test('the footer card is a button, not a link that goes nowhere', async ({ page }) => {
  // Its three neighbours are real links; this one opens a dialog. Rendering it
  // as an <a> without href would break middle-click, "open in new tab" and
  // every screen reader's idea of what it does.
  await login(page);
  const card = page.locator('.colophon__card--share');
  await expect(card).toHaveJSProperty('tagName', 'BUTTON');
  await expect(page.locator('.colophon__card')).toHaveCount(4);
});
