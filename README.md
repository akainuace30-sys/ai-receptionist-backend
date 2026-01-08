# AI Receptionist Backend

A modular Express backend that powers a deterministic, stateful intake assistant for law firms. It combines a finite state machine (FSM) dialogue engine with controlled LLM assists for classification, question phrasing, and summaries, while persisting structured data and audit trails to Postgres.

## Architecture
- **Express API** with `routes/`, `services/`, `prompts/`, and `db/` for clear separation.
- **FSM dialog engine** in `services/dialogService.js` drives deterministic consent → identity → jurisdiction → description → urgency → case-specific questions → summary/confirmation → done.
- **LLM assist (optional)** in `services/llmService.js` for case-type classification, question phrasing, and compact summaries. Output is schema-validated before use.
- **Postgres schema** via `db/migrations/001_init.sql` with `sessions`, `messages`, `intakes`, `consents`, `session_transitions`, and `lead_scores` tables.
- **Lead scoring** in `services/leadScoring.js` produces rule-based scoring and ML-ready factors for routing.
- **Voice adapter skeleton** under `/voice` that produces TwiML and reuses the same FSM via `/dialog`.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment (copy `.env.example`):
   ```bash
   cp .env.example .env
   # Update DATABASE_URL, OPENAI_API_KEY, MODEL_NAME, PORT, LOG_LEVEL
   ```
3. Run migrations and start the server:
   ```bash
   npm start
   ```
   The server runs on `PORT` (default `3000`). Health check: `GET /health`.

For local development without Postgres, the app falls back to an in-memory pg-mem database so migrations and tests still pass.

## API
### POST /dialog
Body: `{ session_id?: string, text: string }`
Returns session, reply, current state, detected case type, extracted and missing fields, lead score/tier/routing, and `done` flag. Creates a new session if `session_id` is absent. Missing `text` yields `400 {"error":"Missing text"}`.

### GET /session/:id
Returns the session snapshot (session row, intake row, messages, transitions). Useful for debugging.

### POST /submit/:id
Marks the intake as submitted (`submitted_to_make=true`) and returns the snapshot (future webhook hook).

### Voice (optional skeleton)
- `POST /voice/inbound` responds with TwiML + `<Gather>` to start the conversation.
- `POST /voice/gather` consumes `SpeechResult/Digits`, calls the same `/dialog` engine, and replies with TwiML.

## Dialogue Flow (FSM)
1. **Consent**: privacy/recording hint, expects yes/no. “Nein” ends the session and records consent outcome.
2. **Name**: ask + confirmation.
3. **Phone**: ask + confirmation; simple DE validation (`+49` or `0` start, min length).
4. **Email**: ask + confirmation (optional via explicit “keine”).
5. **Jurisdiction**: Bundesland (required).
6. **Anliegen**: free-text description captured deterministically; LLM used only for classification.
7. **Urgency**: normalized urgency (niedrig/mittel/hoch).
8. **Case details** (at least three case types):
   - Traffic: `datum`, `ort`, `verletzungen`, `gegner_bekannt`, `polizei`, `schadenhoehe`.
   - Employment: `datum`, `frist`, `arbeitgeber`, `status`, `dokumente`, `streitwert`.
   - Family: `thema`, `datum`, `kinder`, `dringlichkeit_detail`.
9. **Summary + confirmation**: compact recap; “ja” finishes, “nein” triggers corrections and re-summarization.

## Lead Scoring
Rule-based scoring derives `lead_score`, `lead_tier`, and `lead_routing` from case type, urgency, jurisdiction, and monetary indicators. The factors JSON keeps ML-ready features for future models.

## Logging & Compliance
- Structured JSON logs with session correlation (no PII in logs).
- Consent-first intake, auditable transitions, and clear separation of channel adapters.

## Testing
Jest + Supertest cover validation, happy-path flows, and voice adapter behavior. Run:
```bash
npm test
```

## Curl Examples
- Start a new dialog: `curl -X POST http://localhost:3000/dialog -H 'Content-Type: application/json' -d '{"text":"ja"}'`
- Continue with a session: `curl -X POST http://localhost:3000/dialog -H 'Content-Type: application/json' -d '{"session_id":"<id>","text":"Max Mustermann"}'`
- Inspect session: `curl http://localhost:3000/session/<id>`

## Prompts
- `prompts/classify_case_type.prompt` – strict JSON classification for case type.
- `prompts/next_question.prompt` – guidance for phrasing follow-up questions.
- `prompts/final_summary.prompt` – compact, neutral summary template.
