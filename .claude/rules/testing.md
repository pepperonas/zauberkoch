---
paths:
  - "backend/tests/**"
  - "frontend/src/**/*.test.ts"
  - "frontend/src/**/*.test.tsx"
  - "frontend/e2e/**"
description: Test-Regeln
---

# Test-Regeln

- **Backend: pytest.** Jeder Test läuft gegen eine Temp-/In-Memory-SQLite (Fixture aus `conftest.py`), nie gegen `backend/data/`. Anthropic-Client wird IMMER gemockt — kein Test verbraucht echte Tokens.
- Pflicht-Suiten: Auth-Flow (inkl. Allowlist/OPEN_SIGNUP, CSRF), Rate-Limiting (User + global, Tageswechsel), Cache-Logik (Hit/Miss/Regenerieren), Einkaufslisten-Aggregation (Einheiten-Normalisierung), SSE-Parser (Token-Häppchen → semantische Events).
- **Frontend: Vitest.** Standard = **pure Funktionen** ohne DOM (node-env: units/Skalierung, `motifForRecipe`/`variantFor`, `MOTIF_FIT`, mealCompat, i18n, generation-Store). **DOM-abhängige Units** (Hooks, Theme-Toggle, alles was `window`/`navigator`/View-Transitions braucht) nutzen **happy-dom pro Datei** via `// @vitest-environment happy-dom`-Docblock — NICHT global umstellen, sonst verlieren die pure Tests ihre schnelle node-Umgebung. React-Units ohne `@testing-library` testen: ~15-Zeilen-`renderHook` über `react-dom/client` + React-19-`act` (`IS_REACT_ACT_ENVIRONMENT=true` setzen). Beispiele: `useOnline.test.tsx`, `app.test.tsx` (toggleTheme: VT-Reveal einheitlich, kein Overlay, Token-Morph-Fallbacks). `matchMedia`/`startViewTransition`/`api` mocken.
- **E2E: ein Playwright-Smoke** (Login gemockt → Rezept generieren mit gemocktem SSE → favorisieren). Läuft lokal, nicht in CI.
- **E2E-Gotcha:** `playwright.config.ts` setzt `serviceWorkers: 'block'`. Der Preview-Build registriert den PWA-Service-Worker, und **von ihm ausgelöste Requests umgehen `page.route()`** — Mocks fallen dann auf ein nicht laufendes Backend durch (502), scheinbar zufällig, je nachdem ob der SW schon aktiv war. Nie entfernen.
- **Sicherheitszusagen gehören in Tests, nicht nur in Kommentare:** dass ein hinterlegter API-Key weder in `/me` noch im Export auftaucht, und dass die Konto-Löschung wirklich jede Tabelle leert, wird explizit behauptet (`test_byok.py`, `test_account.py`). Bei der Löschung wird **jede Tabelle einzeln geprüft** statt auf `ON DELETE CASCADE` zu vertrauen — SQLite erzwingt Fremdschlüssel nur mit `PRAGMA foreign_keys=ON`, ein Wegfall in `db.py` wäre sonst unsichtbar.
- **⚠️ Kurzlebige Zustände NIE nach dem Ereignis abfragen — vorher aufzeichnen (2026-08-20).** Vier E2E-Zusicherungen lasen `data-tab-dir` bzw. `view-transition-name` per zweitem Round-Trip **nach** dem Klick. Beide leben bewusst nur ~650 ms; auf einer belasteten Maschine landet die Messung danach und meldet „nicht gesetzt" für völlig korrektes Verhalten. Zwei Tests flakten deshalb wechselnd. Richtig: einen `MutationObserver` **vor** der Auslösung installieren und protokollieren, welche Werte je auftraten (`recordStamps`/`recordNamedCards` in `e2e/tabtransition.spec.ts`). Das schließt zugleich das umgekehrte Loch: ein FÄLSCHLICH gesetzter Stempel, den die Aufräumuhr vor der Messung entfernt, käme sonst als „kein Stempel" durch. Umgekehrt ist Umfragen (`expect.poll`) genau dann richtig, wenn der Zielzustand **monoton** ist (z. B. „fällt auf 0 und bleibt dort").
- **⚠️ Am Moment der Momentaufnahme messen, nicht danach.** „Nach dem Klick sind 0 Karten benannt" ist fast leer — die Liste ist da schon ausgehängt, es gibt keine Karten mehr, die benannt sein könnten. Der Test hakt sich stattdessen in `document.startViewTransition` ein und hält fest, welche Namen im Augenblick der Aufnahme existierten. Per Mutation belegt: ohne die `clearTabTransition()`-Sperre in `RecipeCard` schleppt der Detail-Morph 3 zusätzliche `zk-card-*`-Ebenen mit, der Test wird rot.
- Tests deterministisch: keine echten Netzwerk-Requests, Zeit über Fake-/Freeze-Mechanismen.
- **Coverage messen (kein Gate):** Backend `pytest --cov=app` (pytest-cov), Frontend `npm test -- --coverage` (@vitest/coverage-v8, `coverage.include` = ganz `src/` für ehrliche projektweite Zahlen). Frontend-Units decken bewusst die Logik-Schicht (lib/state/i18n) — UI-Flächen gehören dem Playwright-Smoke; Coverage-Lücken dort sind kein Handlungsbedarf.
- Bugfix = erst reproduzierender Test, dann Fix. Vor jedem Deploy: `pytest` + `npm test` grün (deploy.sh erzwingt es).
