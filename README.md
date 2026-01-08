# AI Receptionist Backend

A modular Express backend that powers a deterministic, stateful intake assistant for law firms. It combines a finite state machine (FSM) dialogue engine with light LLM assists for classification, phrasing, and summaries, while persisting structured data to Postgres.

## Architecture
- **Express API** with `routes/`, `services/`, `prompts/`, and `db/` for clear separation.
- **FSM dialog engine** in `services/dialogService.js` drives consent → name/phone → description → case-specific questions → summary/confirmation → done.
- **LLM assist (optional)** in `services/llmService.js` for case-type classification, question phrasing, and compact summaries. Heuristics keep flows deterministic when no key is provided.
- **Postgres schema** via `db/migrations/001_init.sql` with `sessions`, `messages`, and `intakes` tables.
- **Voice adapter skeleton** under `/voice` that produces TwiML and reuses the same FSM via `/dialog`.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment (copy `.env.example`):
   ```bash
   cp .env.example .env
   # Update DATABASE_URL, OPENAI_API_KEY, MODEL_NAME, PORT
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
Returns session, reply, current state, detected case type, extracted and missing fields, and `done` flag. Creates a new session if `session_id` is absent. Missing `text` yields `400 {"error":"Missing text"}`.

### GET /session/:id
Returns the session snapshot (session row, intake row, messages). Useful for debugging.

### POST /submit/:id
Marks the intake as submitted (`submitted_to_make=true`) and returns the snapshot (future webhook hook).

### Voice (optional skeleton)
- `POST /voice/inbound` responds with TwiML + `<Gather>` to start the conversation.
- `POST /voice/gather` consumes `SpeechResult/Digits`, calls the same `/dialog` engine, and replies with TwiML.

## Dialogue Flow (FSM)
1. **Consent**: privacy/recording hint, expects yes/no. “Nein” ends the session.
2. **Name**: ask + confirmation.
3. **Phone**: ask + confirmation; simple DE validation (`+49` or `0` start, min length).
4. **Anliegen**: free-text description captured deterministically; LLM used only for optional structuring.
5. **Case details** (at least three case types):
   - Traffic: `datum`, `ort`, `verletzungen`, `gegner_bekannt`, `polizei`.
   - Employment: `datum`, `frist`, `arbeitgeber`, `status`, `dokumente`.
   - Family: `thema`, `datum`, `kinder`, `dringlichkeit`.
6. **Summary + confirmation**: compact recap; “ja” finishes, “nein” triggers corrections and re-summarization.

## Testing
Jest + Supertest cover validation and happy-path flows. Run:
```bash
npm test
```

## Curl Examples
- Start a new dialog: `curl -X POST http://localhost:3000/dialog -H 'Content-Type: application/json' -d '{"text":"ja"}'`
- Continue with a session: `curl -X POST http://localhost:3000/dialog -H 'Content-Type: application/json' -d '{"session_id":"<id>","text":"Max"}'`
- Inspect session: `curl http://localhost:3000/session/<id>`

## Prompts
- `prompts/classify_case_type.prompt` – strict JSON classification for case type.
- `prompts/next_question.prompt` – guidance for phrasing follow-up questions.
- `prompts/final_summary.prompt` – compact, neutral summary template.
