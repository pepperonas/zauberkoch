# Deploy — zauberkoch.de

**Status: ✅ LIVE seit 2026-07-10.** Erst-Einrichtung abgeschlossen: DNS ✓, systemd `zauberkoch-api` (Port 8742) ✓, nginx-vHost + Let's-Encrypt-Cert ✓, Backup-Timer (03:45) ✓, Allowlist (Betreiber-Konten) ✓. **Eigener Google-OAuth-Client** (`575245359999-…`, Redirect-URI registriert & verifiziert); Creds in `/opt/zauberkoch-api/.env`.

## Ziel-Setup (VPS 69.62.121.168, systemd + zentraler nginx — KEIN Docker)

| Komponente | Wert |
|---|---|
| Frontend-Webroot | `/var/www/zauberkoch.de/` (statischer Vite-Build, SPA-Fallback) |
| Backend | `/opt/zauberkoch-api/` — venv + Code, systemd `zauberkoch-api`, Port **8742** loopback |
| Daten | `/opt/zauberkoch-api/data/zauberkoch.db` (SQLite WAL) |
| Secrets | `/opt/zauberkoch-api/.env` (mode 640, root:www-data) — Vorlage: `.env.example` |
| nginx | eigener vHost `zauberkoch.de` + `www` (301 → Apex); `/api/` → 127.0.0.1:8742; **`/api/v1/recipes/generate` mit `proxy_buffering off` + `proxy_read_timeout 300s`** (SSE); Security-Header (CSP, HSTS) |
| TLS | `certbot --nginx -d zauberkoch.de -d www.zauberkoch.de` |
| Backup | `zauberkoch-backup.timer` nächtlich 03:45 → `/var/backups/zauberkoch/` (sqlite3 `.backup`, gzip, 14 Tage Rotation) |

Port 8742 vor der Einrichtung auf Kollision prüfen: `ssh root@69.62.121.168 'ss -tlnp | grep 8742'`.

## Erst-Einrichtung (Checkliste)

1. **DNS** beim Registrar: A-Records `zauberkoch.de` und `www.zauberkoch.de` → `69.62.121.168`; verifizieren mit `dig +short zauberkoch.de`
2. Verzeichnisse anlegen: `/var/www/zauberkoch.de/`, `/opt/zauberkoch-api/{data}/`
3. Python-3.12-venv auf dem VPS: `python3.12 -m venv /opt/zauberkoch-api/.venv`
4. `.env` anlegen (mode 640): Werte aus `.env.example`; `GOOGLE_CLIENT_ID/SECRET` aus dem bestehenden Client (siehe `/opt/xword-api/.env`), `SESSION_SECRET` neu (`openssl rand -hex 32`), `ZK_ENV=prod`, `ZK_BASE_URL=https://zauberkoch.de`
5. **Google Console:** Redirect-URI `https://zauberkoch.de/api/v1/auth/callback` beim bestehenden OAuth-Client ergänzen (docs/GOOGLE-OAUTH.md)
6. `deploy/zauberkoch-api.service` nach `/etc/systemd/system/` + `daemon-reload` + `enable`
7. nginx-vHost aus `deploy/nginx-vhost.conf` nach `/etc/nginx/sites-available/` + Symlink + `nginx -t && systemctl reload nginx`
8. Certbot (Schritt 1 muss propagiert sein)
9. Backup-Timer aus `deploy/` installieren + `systemctl enable --now zauberkoch-backup.timer`
10. Erster Deploy: `./deploy/deploy.sh` (führt auch `alembic upgrade head` auf dem VPS aus)
11. Allowlist befüllen: `ssh root@69.62.121.168 'cd /opt/zauberkoch-api && .venv/bin/python -m scripts.allowlist add <email>'`
12. Live-Smoke: Login → Generierung streamt → Favorit

## Monitoring & Off-VPS-Backup (seit 2026-07-11)

| Was | Wo | Wann |
|---|---|---|
| Healthcheck → ntfy bei Ausfall (30-min-Cooldown, Recovery-Meldung) | raspi3 cron `/home/pi/bin/zauberkoch-healthcheck.sh` | alle 5 min |
| Fehler-Digest (journalctl ERROR/CRITICAL 24 h) → ntfy | VPS cron `/usr/local/bin/zauberkoch-error-digest.sh` | täglich 06:30 |
| Off-VPS-Backup-Pull (neuester Dump → raspi3, 14 Tage Rotation) | raspi3 cron `/home/pi/bin/zauberkoch-backup-pull.sh` → `/home/pi/zauberkoch-backup/` | täglich 05:00 |

**ntfy-Topic:** privat — liegt auf raspi3 (`~/.zauberkoch-ntfy-topic`) und VPS (`/opt/zauberkoch-api/.ntfy-topic`), dort nachlesen und in der ntfy-App abonnieren. Nie ins Repo committen. SSH: dedizierter Key `raspi3:~/.ssh/id_zauberkoch_backup` → VPS. Restore-Probe zuletzt: 2026-07-11 ✓ (users/recipes aus Dump gelesen).

**Landing-Galerie (Showcase):** 3 kuratierte öffentliche Rezepte unter dem User `showcase@zauberkoch.local`, erzeugt via `scripts/showcase.py` (idempotent; neue Einträge = SHOWCASE-Liste erweitern + auf dem VPS ausführen + Tokens in `LandingPage.tsx`/`sitemap.xml` nachziehen). `robots.txt` + `sitemap.xml` liegen in `frontend/public/`.

**Usage-/Kosten-Report:** `ssh root@69.62.121.168 'cd /opt/zauberkoch-api && .venv/bin/python -m scripts.stats 30'`

## Brand-Assets (Favicon / PWA-Icons / OG)

Alle statischen Brand-Assets in `frontend/public/` (`icon.svg`, `favicon.ico`, `favicon-16/32.png`, `apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`, `og-v2.png`) werden aus EINEM Master-Logo generiert: `cd frontend && npm run gen:assets` (`scripts/generate-assets.mjs`, Playwright-Chromium, kein `sharp`). Die Farb-Single-Source-of-Truth ist das `COLORS`-Objekt im Script (spiegelt `tokens.css`). **Theme-Wechsel = `COLORS` ändern + `npm run gen:assets` + committen**; der Deploy rsync't `public/` nur, er generiert nichts. Bei OG-Änderung den Dateinamen versionieren (`og-v2` → `og-v3`, FB/LinkedIn-Cache) und `index.html`-Meta nachziehen. Visuelle Abnahme: `frontend/scripts/asset-preview.html`. Details: CLAUDE.md → „Brand-Assets".

## Secrets & optionale Konfiguration

| Variable | Pflicht | Zweck |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Projekt-Schlüssel für alle Generierungen ohne eigenen Nutzer-Key |
| `SESSION_SECRET` | ja | Signiert Sessions + zustandslose Verify-/Reset-Tokens (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | für Google-Login | leer ⇒ nur E-Mail/Passwort-Anmeldung |
| `SMTP_HOST/PORT/USER/PASS/FROM` | für E-Mail-Auth | leer ⇒ Mailer ist ein No-Op mit Warnung (dev/tests fassen nie das Netz an) |
| `BYOK_SECRET` | nein | Eigener Wrapping-Key für hinterlegte Nutzer-API-Schlüssel |
| `ZK_ADMIN_EMAILS` | nein | Schaltet das Admin-Panel frei |

**Zu `BYOK_SECRET`:** Nutzer können einen eigenen Anthropic-Schlüssel hinterlegen; der wird
AES-256-GCM-verschlüsselt gespeichert (`app/services/secretbox.py`). Ist `BYOK_SECRET` leer, wird
der Wrapping-Key per HKDF aus `SESSION_SECRET` abgeleitet — es funktioniert also ohne Zutun.
Getrennte Secrets sind trotzdem die bessere Wahl: dann kompromittiert ein geleaktes
`SESSION_SECRET` nicht auch die hinterlegten Schlüssel.

⚠️ **Den Wert nur setzen oder ändern, solange kein Nutzer einen Schlüssel hinterlegt hat.** Eine
Rotation macht bestehende Schlüssel unlesbar; die App behandelt das gnädig (das Konto fällt auf
den Projekt-Schlüssel und die normalen Tageslimits zurück, statt zu brechen), die Betroffenen
müssen ihren Schlüssel aber neu eingeben.

## Migrationen

`deploy.sh` führt `alembic upgrade head` auf dem VPS aus — ein separater Schritt ist nicht nötig.
Bei Migrationen, die eine Tabelle umbauen (SQLite kann Constraints nicht in-place ändern, daher
`batch_alter_table`), vorher gegen eine Kopie der Prod-DB testen:

```bash
scp root@69.62.121.168:/opt/zauberkoch-api/data/zauberkoch.db /tmp/probe.db
cd backend && ZK_DB_PATH=/tmp/probe.db .venv/bin/alembic upgrade head
sqlite3 /tmp/probe.db "SELECT sql FROM sqlite_master WHERE name='<tabelle>';"
```

Neue Dependencies (zuletzt `cryptography` für die BYOK-Verschlüsselung) installiert der Deploy
über `pip install -r requirements.txt` mit; auf dem VPS ist dafür ein passendes Wheel nötig.

## Regel-Deploy

`./deploy/deploy.sh [backend|frontend|all]` — erzwingt vorher `pytest` + `npm test`. Details in `deploy/deploy.sh` und `.claude/skills/deploy/`.
