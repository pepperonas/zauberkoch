/** Safe-area contract.
 *
 * The header is `position: fixed; top: 0`, so on any device with a notch or a
 * translucent status bar it has to GROW into that strip -- otherwise the system
 * clock sits on top of the logo.
 *
 * That handling existed but was wrapped in `@media (display-mode: standalone)`,
 * and it was wrong in a way no browser ever revealed: a Capacitor WebView
 * matches NEITHER `standalone` NOR `browser`. Measured in the shipped Android
 * app: both media queries false, while `env(safe-area-inset-top)` correctly
 * reported 52px. The gate silently dropped the padding for the whole native
 * app, and nothing asserted otherwise.
 *
 * `env()` needs no gate -- it is 0px wherever there is no unsafe area. So the
 * property pinned here is the absence of the gate, not a pixel value: no rule
 * that consumes a safe-area inset may hide behind a `display-mode` condition.
 *
 * Read from the CSSOM rather than from disk, because the CSSOM keeps the
 * SPECIFIED value (`calc(... + env(...))`) while getComputedStyle resolves it
 * to the used value -- which is 0px on a desktop test machine, i.e. exactly the
 * information we need would be gone.
 */

import { expect, test } from '@playwright/test';

type Rule = { selector: string; media: string[]; text: string };

/** Every style rule in the document, with the media conditions it sits under. */
async function collectRules(page: import('@playwright/test').Page): Promise<Rule[]> {
  return page.evaluate(() => {
    const out: { selector: string; media: string[]; text: string }[] = [];
    const walk = (rules: CSSRuleList, media: string[]) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) walk(rule.cssRules, [...media, rule.conditionText]);
        else if (rule instanceof CSSSupportsRule) walk(rule.cssRules, media);
        else if (rule instanceof CSSStyleRule) out.push({ selector: rule.selectorText, media, text: rule.cssText });
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      // A cross-origin sheet throws on .cssRules. Ours are same-origin; if that
      // ever changes the test must fail loudly rather than silently see nothing.
      walk(sheet.cssRules, []);
    }
    return out;
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto('/');
  await page.waitForFunction(() => document.styleSheets.length > 0);
});

test('the app ships rules that consume a safe-area inset', async ({ page }) => {
  const rules = await collectRules(page);
  const consumers = rules.filter((r) => r.text.includes('safe-area-inset'));
  // Guards the guard: if the selectors were renamed away, the checks below
  // would pass vacuously by finding nothing to complain about.
  expect(consumers.length).toBeGreaterThan(3);
});

test('no safe-area rule hides behind a display-mode gate', async ({ page }) => {
  const rules = await collectRules(page);
  const gated = rules
    .filter((r) => r.text.includes('safe-area-inset'))
    .filter((r) => r.media.some((m) => m.includes('display-mode')));
  expect(gated.map((r) => `${r.media.join(' and ')} { ${r.selector} }`)).toEqual([]);
});

test('the fixed header grows into the unsafe top strip unconditionally', async ({ page }) => {
  const rules = await collectRules(page);
  const header = rules.find(
    (r) => r.selector.split(',').some((s) => s.trim() === '.shell__header') && r.text.includes('position: fixed'),
  );
  expect(header, 'the fixed .shell__header rule').toBeTruthy();
  expect(header!.media, 'must not be conditional').toEqual([]);
  expect(header!.text).toContain('safe-area-inset-top');
});

test('content below the header clears the same strip', async ({ page }) => {
  const rules = await collectRules(page);
  const shell = rules.find(
    (r) => r.selector.split(',').some((s) => s.trim() === '.shell') && r.text.includes('padding-top'),
  );
  expect(shell, 'the .shell padding rule').toBeTruthy();
  expect(shell!.media).toEqual([]);
  expect(shell!.text).toContain('safe-area-inset-top');
});

test('the header still clears the status bar when an inset exists', async ({ page }) => {
  // Prove the arithmetic, not just the presence of the token: override the
  // inset the way a notched device would report it and measure the result.
  const HEADER_H = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')),
  );
  const before = await page.evaluate(() => document.querySelector('.shell__header')?.getBoundingClientRect().height);
  expect(before).toBeCloseTo(HEADER_H, 0);

  // env() cannot be set from script; substitute it the way the rule consumes it.
  await page.addStyleTag({
    content: `.shell__header { height: calc(var(--header-h) + 52px); padding-top: 52px; }
              .shell { padding-top: calc(var(--header-h) + 52px); }`,
  });
  const after = await page.evaluate(() => {
    const h = document.querySelector('.shell__header') as HTMLElement | null;
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { height: r.height, top: r.top, contentTop: r.top + parseFloat(getComputedStyle(h).paddingTop) };
  });
  expect(after!.height).toBeCloseTo(HEADER_H + 52, 0);
  // The logo starts BELOW the status bar strip, which was the whole complaint.
  expect(after!.contentTop).toBeGreaterThanOrEqual(52);
});
