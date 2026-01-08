# AI Receptionist Backend

A modular Express backend that powers a deterministic, stateful intake assistant for law firms. It combines a finite state machine (FSM) dialogue engine with controlled LLM assists for classification, question phrasing, and summaries, while persisting structured data and audit trails to Postgres.

## Architecture
- **Express API** with `routes/`, `services/`, `prompts/`, `db/`, and `middleware/` for clear separation.
- **Multi-tenant isolation** via `tenant_id` across sessions, messages, intakes, consent records, and lead scores.
- **FSM dialog engine** in `services/dialogService.js` drives deterministic consent → identity → jurisdiction → description → urgency → case-specific questions → summary/confirmation → done.
- **LLM assist (optional)** in `services/llmService.js` for case-type classification, question phrasing, and compact summaries. Output is schema-validated before use with retry guards.
- **Postgres schema** via `db/migrations/001_init.sql` with `tenants`, `sessions`, `messages`, `intakes`, `consents`, `session_transitions`, and `lead_scores` tables.
- **Lead scoring** in `services/leadScoring.js` produces rule-based scoring and ML-ready factors for routing.
- **Voice adapter skeleton** under `/voice` that produces TwiML and reuses the same FSM via `/dialog`.
- **Structured logging** with request/tenant/session correlation via `services/logger.js`.

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

## Tenancy & Authentication
Each request must include tenant-bound API key headers:
- `x-tenant-id`: UUID of the tenant (law firm)
- `x-api-key`: API key issued for the tenant
- `x-role`: `system`, `tenant_admin`, or `operator` (defaults to `tenant_admin`)

The `tenants` table stores the API key hash and retention policy. Rotate keys by updating `api_key_hash` and deactivating tenants via the `status` column.

## Rate Limiting
In-memory rate limiting is applied per tenant + IP with separate limits:
- `/dialog`: 60 requests/min
- `/voice`: 30 requests/min
- `/submit`: 20 requests/min
- `/session`: 30 requests/min

These limits are enforced in `middleware/rateLimit.js` and can be adjusted for production infrastructure.

## API
### POST /dialog
Body: `{ session_id?: string, text: string }`
Returns session, reply, current state, detected case type, extracted and missing fields, lead score/tier/routing, and `done` flag. Creates a new session if `session_id` is absent. Missing `text` yields `400 {"error":"Missing text"}`.

### GET /session/:id
Returns the session snapshot (session row, intake row, messages, transitions, consent records, lead scores). Useful for debugging and audits.

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

## Compliance & Retention
- Consent-first intake, auditable transitions, and clear separation of channel adapters.
- Soft-delete fields (`deleted_at`) on tenant-scoped tables for retention workflows.
- Tenant-level `retention_days` stored in `tenants` to drive future purge jobs and DSGVO requests.

## Production Readiness
- Structured JSON logs with request/tenant/session correlation (no PII in logs).
- Schema-validated LLM responses with retry protection.
- Rate limiting for abuse prevention.
- Error responses include stable `code` fields for auditability.

## Testing
Jest + Supertest cover validation helpers, dialog flow, consent/abort, session persistence, and voice adapter behavior. Run:
```bash
npm test
```

## Curl Examples
- Start a new dialog:
  ```bash
  curl -X POST http://localhost:3000/dialog \
    -H 'Content-Type: application/json' \
    -H 'x-tenant-id: <tenant-id>' \
    -H 'x-api-key: <api-key>' \
    -d '{"text":"ja"}'
  ```
- Continue with a session:
  ```bash
  curl -X POST http://localhost:3000/dialog \
    -H 'Content-Type: application/json' \
    -H 'x-tenant-id: <tenant-id>' \
    -H 'x-api-key: <api-key>' \
    -d '{"session_id":"<id>","text":"Max Mustermann"}'
  ```
- Inspect session:
  ```bash
  curl -H 'x-tenant-id: <tenant-id>' -H 'x-api-key: <api-key>' http://localhost:3000/session/<id>
  ```

## Prompts
- `prompts/classify_case_type.prompt` – strict JSON classification for case type.
- `prompts/next_question.prompt` – guidance for phrasing follow-up questions.
- `prompts/final_summary.prompt` – compact, neutral summary template.
