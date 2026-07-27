# Zauberkoch 🧑‍🍳🍸

[![CI](https://github.com/pepperonas/zauberkoch-pwa/actions/workflows/ci.yml/badge.svg)](https://github.com/pepperonas/zauberkoch-pwa/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](backend/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](frontend/)
[![Claude API](https://img.shields.io/badge/KI-Claude%20Sonnet-D97757)](https://www.anthropic.com)
[![PayPal](https://img.shields.io/badge/PayPal-Spenden%20%E2%98%95-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/donate/?business=martin.pfeffer%40celox.io&currency_code=EUR)

*English version: [README.en.md](README.en.md)*

**KI-Rezept- & Cocktail-Generator** — live unter **[zauberkoch.de](https://zauberkoch.de)**

Küche wählen, Geschmack wählen, Rahmenbedingungen setzen — der Zauberkoch schreibt ein Rezept auf Kochbuch-Niveau mit exakten Mengen. Das Rezept **baut sich live vor deinen Augen auf** (SSE-Streaming, kein Spinner-Gefängnis): erst Titel und Teaser, dann Zutat für Zutat, dann die Schritte.

## Screenshots

<p align="center">
  <img src="docs/screenshots/landing.png" alt="Landing Page" width="720">
</p>
<p align="center">
  <img src="docs/screenshots/wizard-dark.png" alt="Wizard (Dark Mode)" width="30%">
  <img src="docs/screenshots/recipe.png" alt="Gestreamtes Rezept" width="30%">
  <img src="docs/screenshots/cook-mode.png" alt="Koch-Modus" width="30%">
</p>

## Features

- 🪄 **Live-Streaming-Generierung** — semantische SSE-Events (Titel → Zutaten → Schritte → Tipps) aus einem inkrementellen JSON-Parser über der Claude-API (Structured Outputs, Prompt-Caching, disconnect-fest)
- 🧙 **Magischer Kessel** — während der Generierung kreisen die echten Zutaten als Emojis um einen Kessel (bzw. Shaker im Cocktail-Modus) und fallen bei jedem Stream-Event mit Funken-Burst hinein; der Titel materialisiert Wort für Wort
- 🔄 **Navigationsfeste Generierung** — der Stream lebt in einem globalen Store und läuft beim Seitenwechsel weiter; eine schwebende Status-Pille („🪄 Rezept wird gezaubert …" → „✨ fertig!") führt jederzeit zurück
- ✨ **Anpassen per Zuruf** — jedes Rezept per Chip oder Freitext abwandeln („schärfer", „ohne Ofen", „für Meal-Prep")
- 👤 **Präferenz-Profil** — Ernährungsform, No-Go-Zutaten und Standard-Personenzahl fließen automatisch in jede Generierung
- 👍 **Feedback pro Rezept** (mit Grund-Chips) — fließt in die Prompt-Iteration; 📝 persönliche Koch-Notizen + „Gekocht"-Zähler
- 🍳/🍸 **Zwei Modi** — Kochen & Cocktails (inkl. Mocktails, cl-Angaben, shaken/stirred/built), mit animiertem Farbschema-Morph (Safran ↔ Violett)
- 🧙 **3-Schritt-Wizard**, komplett überspringbar: Gericht-Art, Länderküche (personalisierbare Chips), Geschmacks-Chips, Constraints (Diät, Zeit, Schwierigkeit, „Was hab ich im Kühlschrank"), „Überrasch mich"
- ✨ **Probier-Zauber** — ein Rezept direkt auf der Landing-Page generieren, ganz ohne Anmeldung (fair-use-limitiert)
- 📷 **Kühlschrank-Scan** — Foto hochladen, die Vision-KI erkennt die Zutaten und füllt den Kühlschrank-Schritt
- 🔁 **Zutaten-Ersatz** — fehlt eine Zutat, liefert ein Mini-KI-Call 2–3 realistische Alternativen mit Mengen-Hinweis
- 📱 **Koch-Modus** — Vollbild, ein Schritt pro Screen, Swipe-Navigation, integrierte Timer, Wake Lock, **Sprachsteuerung** („weiter" / „zurück" / „beenden", Web Speech API)
- 📅 **Wochenplaner** — Rezepte auf Wochentage legen, „Woche → Einkaufsliste" aggregiert alles in einem Schritt; jeder Plan-Eintrag öffnet sein Rezept per Container-Transform
- 🔢 **Portionen-Stepper** mit live skalierenden Mengen und rollenden Ziffern
- 🛒 **Einkaufsliste** — Zutaten mehrerer Rezepte werden aggregiert (Einheiten normalisiert: kg→g, cl→ml), Drag-Reorder, Teilen, überall Undo
- ⭐ **Favoriten & Verlauf** mit Suche und Filtern
- 🔗 **Teilen** — unlisted Links mit server-seitig generierten OG-Thumbnails (Pillow, 1200×630); geteilte Rezepte können in die eigene Sammlung übernommen werden
- 🎨 **Material 3 Expressive, handgebaut** — Design-Tokens als CSS Custom Properties, echte Spring-Physik (Motion), Theme-Wechsel als Circular Reveal (View Transitions API), `prefers-reduced-motion` überall
- 🎞️ **Shared-Element-Navigation** — Grafik und Titel wandern per **Material Container Transform** (native View Transitions API) in die Detailansicht — aus der Rezeptliste, dem Wochenplaner und der Einkaufsliste; Tabs faden through, Zurück morpht zurück — **auch der Browser-Back-Button auf Mobile** (react-router Data-Router-View-Transitions), alles GPU-composited (nur `transform`/`opacity`)
- 📺 **CRT-Abschalt-Logout** — beim Abmelden kollabiert der Screen wie ein alter Röhrenfernseher (Scanline → Punkt → Ausglühen), theme-bewusst und `prefers-reduced-motion`-fest
- 💬 **Erklärende Hover-Tooltips** an den Aktions-Buttons (Desktop, `prefers-reduced-motion`-fest)
- 🔑 **Eigener Anthropic-Schlüssel (BYOK)** — optional den eigenen API-Key hinterlegen und ohne Tageslimit zaubern; der Schlüssel wird AES-256-GCM-verschlüsselt gespeichert, nie angezeigt und nie an den Browser zurückgegeben (nur die letzten vier Zeichen)
- 📤 **Datenexport & Konto-Löschung in der App** — Auskunft und Übertragbarkeit als eine JSON-Datei, Löschung mit einem Klick (DSGVO Art. 15/17/20, ohne E-Mail-Anfrage)
- 🖨️ **Druckansicht** — Rezept als Küchenblatt oder PDF, schwarz auf weiß, ohne App-Rahmen; geschriebene Notizen kommen mit, leere Felder nicht
- 🛡️ **Admin-Panel** — Nutzungs-/Kosten-Dashboard (Generierungen, Tokens, Cache-Quote, Feedback pro Prompt-Version) + Allowlist-Verwaltung, per `ZK_ADMIN_EMAILS` freigeschaltet
- 📲 **PWA** — installierbar, Favoriten offline lesbar, unaufdringlicher Offline-Indikator statt Fehlerseiten
- 🔐 **Zwei Anmeldewege** — Google OAuth (PKCE, server-seitig) **und** E-Mail/Passwort (scrypt, Double-Opt-in, Passwort-Reset); httpOnly-Sessions, CSRF-Schutz, Tageslimits pro User + global
- 🚀 **Lighthouse 99 / 100 / 100 / 100** (Performance / Accessibility / Best Practices / SEO, gemessen gegen Prod)

## Stack

| Layer | Technologie |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLite (WAL) · SQLAlchemy 2 · Alembic |
| KI | Anthropic API (`claude-sonnet-5`, per env tauschbar) · Streaming · Structured Outputs · Prompt-Caching |
| Frontend | React 19 · Vite · TypeScript strict · TanStack Query · Motion |
| Auth | Google OAuth 2.0 (Authorization Code + PKCE) · E-Mail/Passwort (scrypt) · httpOnly-Cookies |
| Krypto | scrypt (Passwörter) · HMAC (zustandslose Tokens) · AES-256-GCM (hinterlegte API-Schlüssel) |
| Deploy | systemd + nginx (SSE-tauglich) · Let's Encrypt |

## Lokales Setup

**Schnellster Weg (Docker, ohne Google-Client):**

```bash
cp .env.example backend/.env      # ANTHROPIC_API_KEY eintragen, ZK_DEV_LOGIN=true
docker compose -f docker-compose.dev.yml up
# → http://localhost:5173 → „Dev-Login (lokal)"
```

**Nativ:**

```bash
# Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp ../.env.example .env        # ANTHROPIC_API_KEY, Google-Creds, SESSION_SECRET eintragen
alembic upgrade head
python -m scripts.allowlist add du@example.com
uvicorn app.main:app --reload --port 8742

# Frontend (zweites Terminal)
cd frontend
npm install
npm run dev                    # http://localhost:5173, /api → Proxy auf :8742
```

Google-OAuth-Einrichtung: [`docs/GOOGLE-OAUTH.md`](docs/GOOGLE-OAUTH.md) · Deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md)

## Tests

```bash
cd backend && pytest             # 232 Tests: Auth (Google + E-Mail/Passwort), Rate-Limits, Cache & Dedup,
                                 #   SSE-Parser, KI-Orchestrierung, Prompts, Share/OG, Kostenmodell,
                                 #   Konto-Export/-Löschung, BYOK-Verschlüsselung
cd backend && pytest --cov=app   # Coverage-Report (Stand 2026-07-27: 94 % Statements)
cd frontend && npm test          # 115 Tests: Mengen-Skalierung, Einheiten, i18n, SSE-Client, API-Client,
                                 #   Theme-Toggle, Stores, Zutaten-Katalog, Motive
cd frontend && npm test -- --coverage   # Stand 2026-07-27: 21 % projektweit — bewusst: Units decken die
                                        #   Logik-Schicht (lib/state/i18n), die React-UI-Flächen deckt E2E ab
cd frontend && npx playwright test   # 8 E2E-Tests (lokal): Login → Generierung → Favorit, Export,
                                     #   Konto-Löschung, BYOK-Dialog, Druckansicht
```

**Sicherheitskritisches ist bewusst doppelt abgesichert:** Die Konto-Löschung prüft *jede*
betroffene Tabelle einzeln, statt auf `ON DELETE CASCADE` zu vertrauen (SQLite erzwingt
Fremdschlüssel nur mit `PRAGMA foreign_keys=ON`), und die BYOK-Tests behaupten explizit, dass
weder `/me` noch der Datenexport je einen Schlüssel im Klartext enthalten.

Alle Suiten laufen bei jedem Push als [GitHub Action](.github/workflows/ci.yml). Kein Test ruft die echte Anthropic-API auf.

## Mitmachen

Beiträge willkommen — siehe [CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitslücken bitte via [SECURITY.md](SECURITY.md) melden.

## Unterstützen

Zauberkoch ist ein Hobby-Projekt. Wenn es dir gefällt:

[![PayPal-Spende](https://img.shields.io/badge/☕%20Spendier%20mir%20einen%20Kaffee-PayPal-00457C?logo=paypal&logoColor=white&style=for-the-badge)](https://www.paypal.com/donate/?business=martin.pfeffer%40celox.io&currency_code=EUR)

## Lizenz & Credits

[MIT](LICENSE) © 2026 Martin Pfeffer | [celox.io](https://celox.io)

Fonts: [Inter](https://rsms.me/inter/) und [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (SIL Open Font License). Gebaut mit [Claude Code](https://claude.com/claude-code).
