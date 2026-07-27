---
paths:
  - "backend/**"
description: Backend-Regeln (FastAPI, SQLAlchemy, Sicherheit, KI-Pipeline)
---

# Backend-Regeln

- **FastAPI + SQLAlchemy 2 (typed, `Mapped[]`) + Pydantic v2.** Sync-SQLite mit WAL; DB-Datei nur unter `backend/data/` (gitignored).
- **Jede Schema-Änderung braucht eine Alembic-Migration** — nie `create_all` als Ersatz in Prod-Pfaden.
- **Input-Validierung server-seitig** über Pydantic-Schemas; Limits/Zugriffskontrolle nie dem Client überlassen.
- Konsistentes Fehlerformat `{"error": {"code", "message"}}` mit korrektem HTTP-Status; keine Stacktraces an den Client. 429 enthält `retry_after`.
- **Secrets nur aus Settings/env** (`app/core/config.py`), niemals hartcodieren oder loggen. `ANTHROPIC_API_KEY` verlässt den Server nie.
- Sessions: httpOnly + SameSite=Lax (+ Secure in prod), DB-gestützt, Ablauf serverseitig geprüft. CSRF-Double-Submit auf allen state-changing Routen.
- **Anthropic-Calls nur in `app/services/ai.py`**, immer Streaming (`client.messages.stream`), Modell aus `ANTHROPIC_MODEL`. Kein `temperature` o.ä. hartkodieren.
- Rezept-Prompts nur in `app/prompts/` (versioniert); Prompt-Version am Rezept persistieren. Prompt-Änderung = neue Version, alte bleibt.
- Structured Logging (JSON) über `app/core/logging.py` — kein `print`.
- Neue Endpoints bekommen pytest-Tests (Temp-DB-Fixture, Anthropic gemockt — nie echte API-Calls in Tests).
- **Fremde Secrets nur über `app/services/secretbox.py`** (AES-256-GCM): hinterlegte Anthropic-Keys werden NIE im Klartext gespeichert, geloggt, in eine API-Antwort oder in den Datenexport geschrieben — nach außen geht nur `{active, hint}` (letzte 4 Zeichen). Kein selbstgebautes Krypto-Schema; Wrapping-Key aus `BYOK_SECRET`, sonst HKDF aus `SESSION_SECRET` mit eigenem Info-Label. `decrypt()` darf nicht werfen: ein unlesbarer Eintrag zählt als „nicht vorhanden".
- **BYOK-Invariante:** `byok.key_for(user)` ist das EINZIGE Prädikat für „unbegrenzt". Jeder neue Limit-Check (`consume_*`) und jeder neue AI-Aufruf lesen dieselbe Funktion — nie eine zweite Bedingung erfinden, sonst driften Limit-Skip und tatsächliche Key-Nutzung auseinander. Neue AI-Einstiegspunkte bekommen `api_key: str | None = None` und reichen ihn an `ai.get_client(api_key)` durch; wer auf fremdem Key generiert, schreibt `Generation(byok=True)`, damit die Kosten nicht uns zugerechnet werden.
- **Konto-Löschung ist vollständig zu halten:** neue Tabellen mit `user_id` bekommen `ondelete="CASCADE"` UND einen Eintrag in `tests/test_account.py::test_removes_every_attached_row`. Tabellen ohne Fremdschlüssel (`rate_limits`-Scopes, `allowlist`) müssen in `delete_account` von Hand geräumt werden. Aggregate ohne Personenbezug (`generations`) werden entkoppelt statt gelöscht.
- **Rezepte sind soft-deleted** (`recipes.deleted_at`): jede neue nutzer-sichtbare Recipe-Query MUSS `deleted_at IS NULL` filtern — für Owner-Lookups `owned_recipe(db, id, user_id)` (aus `recipes.py`) nutzen, für Joins/Listen die Bedingung explizit ergänzen. Hard-Delete ist bewusst nicht vorgesehen (Cache-Erhalt).
