/**
 * Brand-asset generator — single source of truth for all static PWA/social icons.
 *
 *   node scripts/generate-assets.mjs
 *
 * Renders ONE master chef-hat logo (mint theme, Material-flat per
 * ILLUSTRATION_STYLE.md) into every raster size via headless Chromium
 * (Playwright — already a dev dep, no native `sharp` build needed).
 * The favicon .ico is assembled from PNG payloads by a tiny inline encoder.
 *
 * Future theme change = edit COLORS below and re-run. That's the one-liner.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PUBLIC = new URL('../public/', import.meta.url);
const out = (name) => new URL(name, PUBLIC);

// ── Single source of truth (mirrors tokens.css mint palette) ──────────────
const COLORS = {
  iconBg: '#14531f', // dark theme --c-primary-container: deep brand green
  hat: '#b1f0b2', // light --c-primary-container: pale mint (hat body)
  band: '#a0cfd3', // dark --c-tertiary: teal hat band
  spark: '#f0b429', // --icon-gold: magic spark
  ogBg1: '#0e140c', // OG background gradient (dark green)
  ogBg2: '#17331d',
  ogGlow: '#2c5e32', // dark --c-hero-glow
  ogWord: '#eaf3e4', // wordmark (near-white, green-biased)
  ogAccent: '#96d98d', // dark --c-primary: mint accent
  ogMuted: '#9fb098', // tagline
  ogFoot: '#71806c', // footer line
};

const YEAR = new Date().getFullYear();
const TAGLINE = 'Dein KI-Koch für Rezepte & Cocktails';

// ── Master logo: chef hat + gold spark on a 24-unit grid ──────────────────
// Same geometry as the in-app `logo` glyph (components/icons/glyphs.tsx),
// so the favicon and the header logo are the exact same mark.
function hatGroup() {
  return `
    <g fill="${COLORS.hat}">
      <circle cx="7.6" cy="8.6" r="3.4"/>
      <circle cx="12" cy="6.6" r="4"/>
      <circle cx="16.4" cy="8.6" r="3.4"/>
      <path d="M6 9.5h12v6.4H6Z"/>
    </g>
    <rect x="6" y="17.2" width="12" height="2.9" rx="1.45" fill="${COLORS.band}"/>
    <path d="M21 1.6 21.7 3.3 23.4 4 21.7 4.7 21 6.4 20.3 4.7 18.6 4 20.3 3.3 Z" fill="${COLORS.spark}"/>`;
}

/**
 * Build an icon SVG. `hatFrac` = fraction of the canvas the 24-unit hat box
 * spans (centered). `bg`: 'rounded' | 'square' | 'none'.
 */
function iconSVG(size, hatFrac, bg) {
  const s = (size * hatFrac) / 24;
  const off = (size - 24 * s) / 2;
  let bgEl = '';
  if (bg === 'rounded') bgEl = `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${COLORS.iconBg}"/>`;
  else if (bg === 'square') bgEl = `<rect width="${size}" height="${size}" fill="${COLORS.iconBg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bgEl}<g transform="translate(${off} ${off}) scale(${s})">${hatGroup()}</g></svg>`;
}

// Scalable favicon (viewBox-based, rounded) — the live icon.svg
function iconSVGScalable() {
  const V = 512;
  const s = (V * 0.66) / 24;
  const off = (V - 24 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}"><rect width="${V}" height="${V}" rx="${V * 0.22}" fill="${COLORS.iconBg}"/><g transform="translate(${off} ${off}) scale(${s})">${hatGroup()}</g></svg>`;
}

function ogHTML() {
  const bric = readFileSync(new URL('fonts/bricolage.woff2', PUBLIC)).toString('base64');
  const inter = readFileSync(new URL('fonts/inter.woff2', PUBLIC)).toString('base64');
  const logo = iconSVG(300, 0.72, 'rounded');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'Bricolage';src:url(data:font/woff2;base64,${bric}) format('woff2');font-weight:400 800;}
    @font-face{font-family:'Inter';src:url(data:font/woff2;base64,${inter}) format('woff2');font-weight:400 700;}
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:630px;overflow:hidden;
      background:radial-gradient(680px 520px at 16% 8%, ${COLORS.ogGlow}66, transparent 70%),
        linear-gradient(150deg, ${COLORS.ogBg1}, ${COLORS.ogBg2});
      font-family:'Inter',system-ui;display:flex;flex-direction:column;
      justify-content:center;padding:76px 88px;color:${COLORS.ogWord}}
    .row{display:flex;align-items:center;gap:44px}
    .logo{width:200px;height:200px;flex:none;filter:drop-shadow(0 10px 24px #0006)}
    .logo svg{width:100%;height:100%;display:block}
    .word{font-family:'Bricolage';font-weight:800;font-size:100px;line-height:1;letter-spacing:-.02em}
    .tag{margin-top:44px;font-size:37px;color:${COLORS.ogMuted};font-weight:500;max-width:940px;line-height:1.35}
    .accent{color:${COLORS.ogAccent}}
    .foot{position:absolute;left:88px;bottom:52px;font-size:26px;color:${COLORS.ogFoot};letter-spacing:.01em}
  </style></head><body>
    <div class="row"><div class="logo">${logo}</div>
      <div><div class="word">Zauberkoch</div></div></div>
    <div class="tag">${TAGLINE} — <span class="accent">live gezaubert</span>, Zutat für Zutat.</div>
    <div class="foot">© ${YEAR} Martin Pfeffer | celox.io</div>
  </body></html>`;
}

// ── Minimal ICO encoder (PNG payloads; accepted by all modern browsers) ───
function buildIco(entries /* [{size, png:Buffer}] */) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const dv = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0); // width
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // palette
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bpp
    dir.writeUInt32LE(e.png.length, b + 8); // bytes
    dir.writeUInt32LE(offset, b + 12); // offset
    offset += e.png.length;
    dv.push(e.png);
  });
  return Buffer.concat([header, dir, ...dv]);
}

// ── Render pipeline ───────────────────────────────────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage();

async function pngFromSVG(svg, size, { opaque = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}</style>${svg}`, { waitUntil: 'load' });
  const buf = await page.screenshot({
    omitBackground: !opaque,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  return buf;
}

// icons (any purpose — rounded, transparent corners)
const png16 = await pngFromSVG(iconSVG(16, 0.72, 'rounded'), 16);
const png32 = await pngFromSVG(iconSVG(32, 0.7, 'rounded'), 32);
const png48 = await pngFromSVG(iconSVG(48, 0.68, 'rounded'), 48);
const png192 = await pngFromSVG(iconSVG(192, 0.66, 'rounded'), 192);
const png512 = await pngFromSVG(iconSVG(512, 0.66, 'rounded'), 512);
// apple-touch — OPAQUE full square + padding (iOS renders transparent as black)
const pngApple = await pngFromSVG(iconSVG(180, 0.6, 'square'), 180, { opaque: true });
// maskable — OPAQUE full bleed, motif inside 80% safe zone
const pngMask = await pngFromSVG(iconSVG(512, 0.62, 'square'), 512, { opaque: true });

writeFileSync(out('favicon-16.png'), png16);
writeFileSync(out('favicon-32.png'), png32);
writeFileSync(out('icon-192.png'), png192);
writeFileSync(out('icon-512.png'), png512);
writeFileSync(out('icon-maskable-512.png'), pngMask);
writeFileSync(out('apple-touch-icon.png'), pngApple);
writeFileSync(out('favicon.ico'), buildIco([
  { size: 16, png: png16 },
  { size: 32, png: png32 },
  { size: 48, png: png48 },
]));
writeFileSync(out('icon.svg'), iconSVGScalable());

// OG / Twitter card (1200×630)
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogHTML(), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const og = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
// ⚠️ Die Wurzel-OG-Karte wird NICHT mehr hier erzeugt.
// Seit 2026-09-16 ist /og-v3.png ein gestaltetes Bild (Topf-Motiv mit
// Wortmarke und Funktionen), kein aus dem Logo gerendertes Blatt. Ein
// writeFileSync() an dieser Stelle wuerde es beim naechsten
// `npm run gen:assets` stillschweigend ueberbuegeln.
// Neue Karte = neue Versionsnummer (og-vN.png) + index.html nachziehen:
// Facebook und LinkedIn cachen Vorschaubilder hartnaeckig.
void og;

await browser.close();
console.log('✔ Brand assets written to public/: icon.svg, favicon.ico, favicon-16/32.png,');
console.log('  apple-touch-icon.png, icon-192/512.png, icon-maskable-512.png (og-vN.png: handgepflegt)');
