# Zauberkoch 🧑‍🍳🍸

*Deutsche Version: [README.md](README.md)*

[![CI](https://github.com/pepperonas/zauberkoch-pwa/actions/workflows/ci.yml/badge.svg)](https://github.com/pepperonas/zauberkoch-pwa/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](backend/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](frontend/)
[![PayPal](https://img.shields.io/badge/PayPal-Donate%20%E2%98%95-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/donate/?business=martin.pfeffer%40celox.io&currency_code=EUR)

**AI recipe & cocktail generator** — live at **[zauberkoch.de](https://zauberkoch.de)** (German UI)

Pick a cuisine, flavors and constraints — the app streams a cookbook-quality recipe with exact metric amounts, **building up live** on screen (SSE, no spinner jail): title and teaser first, then ingredient by ingredient, then the steps.

<p align="center">
  <img src="docs/screenshots/wizard-dark.png" alt="Wizard (dark)" width="30%">
  <img src="docs/screenshots/recipe.png" alt="Streamed recipe" width="30%">
  <img src="docs/screenshots/cook-mode.png" alt="Cook mode" width="30%">
</p>

## Highlights

- **Live streaming generation** — an incremental JSON parser turns the Claude token stream into semantic SSE events (structured outputs + prompt caching keep it reliable and cheap)
- **Magic cauldron** — while generating, the actual ingredients orbit a cauldron (or shaker in cocktail mode) as emojis and drop in with spark bursts on every stream event; the title reveals word by word
- **Navigation-proof generation** — the stream lives in a global store and keeps running while you browse the app; a floating pill brings you back to the running or finished recipe
- **Two modes** — cooking & cocktails (incl. mocktails, cl measurements, shaken/stirred/built), with an animated color-scheme morph (saffron ↔ violet)
- **Adapt on demand** — tweak any recipe via chips or free text ("spicier", "no oven", "meal-prep")
- **Preference profile** — diet, no-go ingredients and default servings merged into every generation
- **Try without signing up** — generate one recipe right on the landing page, no account needed (fair-use limited)
- **Fridge scan** — upload a photo, the vision model recognizes your ingredients and fills the fridge step
- **Ingredient substitution** — missing something? A small AI call suggests 2–3 realistic alternatives with quantity hints
- **Weekly planner** — drop recipes onto weekdays, "week → shopping list" aggregates everything in one step; every planned entry opens its recipe via container transform
- **Cook mode** — fullscreen, one step per screen, swipe navigation, built-in timers (chime + notification), wake lock, **voice control** (Web Speech API)
- **Lighthouse 99/100/100/100** measured against production
- **Shopping list** with unit normalization and aggregation, drag reorder, undo everywhere
- **Sharing** — unlisted links with server-rendered OG thumbnails (Pillow, 1200×630); shared recipes can be adopted into your own collection
- **Handmade Material 3 Expressive** — design tokens as CSS custom properties, real spring physics (Motion), circular-reveal theme switch (View Transitions API), `prefers-reduced-motion` throughout
- **Shared-element navigation** — dish graphic and title morph into the detail view via **Material Container Transform** (native View Transitions API) — from the recipe list, the weekly planner and the shopping list; tabs fade through, back reverses the morph — **including the browser back button on mobile** (react-router data-router view transitions), all GPU-composited (`transform`/`opacity` only)
- **CRT power-off logout** — signing out collapses the screen like an old tube TV (scanline → dot → afterglow), theme-aware and `prefers-reduced-motion`-safe
- **Explanatory hover tooltips** on the action buttons (desktop, `prefers-reduced-motion`-safe)
- **Bring your own key** — optionally store your own Anthropic API key and generate without any daily cap; the key is stored AES-256-GCM encrypted, never displayed and never returned to the browser (only its last four characters)
- **Data export & account deletion in-app** — access and portability as one JSON file, deletion in one click (GDPR Art. 15/17/20, no email request needed)
- **Print view** — a recipe as a kitchen sheet or PDF, black on white, without the app chrome; a written note comes along, an empty one does not
- **Admin panel** — usage/cost dashboard (generations, tokens, cache rate, feedback per prompt version) + allowlist management, gated via `ZK_ADMIN_EMAILS`
- **PWA** — installable, favorites readable offline, unobtrusive offline indicator instead of error pages
- **Two ways in** — Google OAuth (PKCE, server-side) **and** email/password (scrypt, double opt-in, password reset); httpOnly sessions, CSRF protection, per-user and global daily limits

## Tests

347 automated tests run on every push via [GitHub Actions](.github/workflows/ci.yml): 232 backend (pytest, 94 % statement coverage as of 2026-07-27) and 115 frontend (Vitest). Unit coverage deliberately targets the logic layer; project-wide it sits at 21 % because the React surface is E2E territory — 8 Playwright tests cover login → generation → favorite, data export, account deletion, the BYOK dialog and the print view locally.

The security-critical parts are asserted twice over: account deletion checks *every* affected table individually instead of trusting `ON DELETE CASCADE` (SQLite only enforces foreign keys while `PRAGMA foreign_keys=ON` is set), and the BYOK tests explicitly assert that neither `/me` nor the data export ever contains a key in plaintext. No test ever calls the real Anthropic API.

## Stack

Python 3.12 · FastAPI · SQLite · SQLAlchemy 2 · Alembic — Anthropic API (streaming, structured outputs, prompt caching) — React 19 · Vite · TypeScript strict · TanStack Query · Motion — Google OAuth (PKCE) and email/password, httpOnly sessions. Crypto: scrypt for passwords, HMAC for stateless tokens, AES-256-GCM for stored API keys.

## Quickstart

```bash
cp .env.example backend/.env      # set ANTHROPIC_API_KEY, ZK_DEV_LOGIN=true
docker compose -f docker-compose.dev.yml up
# → http://localhost:5173 → "Dev-Login (lokal)" — no Google client needed
```

Native setup, tests and deployment: see [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Martin Pfeffer | [celox.io](https://celox.io) — Fonts: Inter & Bricolage Grotesque (SIL OFL). Built with [Claude Code](https://claude.com/claude-code).
