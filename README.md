# Vaami Voice Intelligence

Vaami is a full-stack voice-call logging application. A user starts a browser
voice call, talks to a Python Pipecat agent, and receives a streamed response.
When the call ends, the bot sends the authoritative transcript and pipeline
latency metrics to a Cloudflare Worker, which stores them in D1.

The project is intentionally split into three independently runnable services:

| Service | Directory | Technology | Local URL |
| --- | --- | --- | --- |
| Dashboard | `frontend/` | Next.js 15, React, TypeScript, Tailwind CSS | `http://localhost:3000` |
| Voice bot | `bot/` | Python, FastAPI, Pipecat, SmallWebRTC | `http://localhost:7860` |
| API and database | `worker/` | Cloudflare Workers, TypeScript, D1, Wrangler | `http://localhost:8787` |

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Browser: Next.js dashboard                                     │
│ Calls · Stats · Live call · Dev console                        │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
       WebRTC SDP offer/answer             REST reads
       POST /api/offer                     GET /calls
                │                         GET /stats
                ▼                               ▼
┌───────────────────────────┐      ┌─────────────────────────────┐
│ Python voice bot          │      │ Cloudflare Worker            │
│ FastAPI + SmallWebRTC     │─────▶│ Validation + CORS + auth      │
│ Pipecat pipeline          │ POST │ Atomic D1 persistence         │
└─────────────┬─────────────┘      └──────────────┬──────────────┘
              │                                    │
   Deepgram STT → Groq LLM → Cartesia/ElevenLabs  ▼
                                             Cloudflare D1
                                    calls · transcripts · call_metrics
```

### Runtime responsibilities

- **Frontend** owns the user experience, microphone permission, WebRTC
  offer/answer exchange, call controls, call list, call details, and summary
  statistics.
- **Bot** owns real-time audio processing, speech recognition, turn detection,
  LLM responses, text-to-speech, transcript collection, and latency metrics.
- **Worker** owns API validation, CORS, optional API-key authentication,
  structured request logging, and database writes.
- **D1** is the only persistent data store. The browser never writes directly
  to the database.

## End-to-end call pipeline

1. The user selects **Start a call** in the Next.js dashboard.
2. The browser requests microphone access and creates a
   `RTCPeerConnection`.
3. The browser gathers ICE candidates and sends the SDP offer to
   `POST /api/offer` on the bot.
4. The FastAPI bot creates a `SmallWebRTCConnection` and returns an SDP answer.
5. Pipecat processes the audio through:

   ```text
   Browser microphone
       → SmallWebRTC input
       → Silero VAD
       → Deepgram STT
       → user context aggregator
       → Groq LLM
       → Cartesia or ElevenLabs TTS
       → SmallWebRTC output
       → Browser speaker
   ```

6. The browser and bot exchange live audio over WebRTC.
7. Pipecat records user and assistant turns and TTFB metrics for STT, LLM,
   and TTS.
8. When the call closes, the bot sends one payload to `POST /calls`.
9. The Worker inserts the call, transcript turns, and metrics in one D1 batch.
10. The dashboard refreshes and displays the completed call.

## Repository layout

```text
.
├── bot/
│   ├── bot.py                 # Pipecat pipeline and call persistence
│   ├── server.py              # FastAPI WebRTC signaling server
│   ├── requirements.txt      # Pinned-compatible Python dependencies
│   ├── .env.example           # Bot configuration template
│   └── .venv/                 # Local virtual environment (not committed)
├── frontend/
│   ├── app/
│   │   ├── page.tsx           # Dashboard tabs and call list
│   │   ├── call/page.tsx      # Call detail and transcript view
│   │   └── globals.css        # Visual system and responsive styles
│   ├── components/StartCall.tsx
│   ├── lib/api.ts             # Worker API client and formatting helpers
│   ├── next.config.mjs        # Static export configuration
│   └── postcss.config.mjs     # Tailwind CSS v4 integration
├── worker/
│   ├── src/index.ts           # Worker routes and request handling
│   ├── migrations/0001_init.sql
│   ├── wrangler.toml          # Worker and D1 configuration
│   └── package.json
└── .github/workflows/deploy.yml
```

## Prerequisites

- Node.js 20 or newer
- npm
- Python 3.10–3.13
- A browser with microphone support
- API keys for:
  - [Deepgram](https://console.deepgram.com)
  - [Groq](https://console.groq.com)
  - [Cartesia](https://play.cartesia.ai), or ElevenLabs
- A Cloudflare account for remote Worker, Pages, and D1 deployment

## Local setup

Run each service in a separate terminal.

### 1. Worker and local D1

Windows PowerShell:

```powershell
cd worker
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

macOS/Linux:

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

The migration creates:

- `calls`: one row per call
- `transcripts`: ordered user and assistant turns
- `call_metrics`: per-stage TTFB summaries

The local API is available at `http://localhost:8787`.

### 2. Python voice bot

Windows PowerShell:

```powershell
cd bot
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python server.py
```

macOS/Linux:

```bash
cd bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python server.py
```

Fill in the keys in `bot/.env` before making a call:

```dotenv
DEEPGRAM_API_KEY=...
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
TTS_PROVIDER=cartesia
CARTESIA_API_KEY=...
WORKER_URL=http://localhost:8787
WORKER_API_KEY=dev-secret-change-me
CORS_ORIGINS=http://localhost:3000
```

The first bot startup may download the Silero VAD model.

### 3. Next.js frontend

Windows PowerShell:

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

macOS/Linux:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`, allow microphone access, and select **Start a
call**.

## Configuration

### Frontend

`frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8787
NEXT_PUBLIC_BOT_URL=http://localhost:7860
```

These values are embedded at build time for a static Next.js export.

### Worker

`worker/.dev.vars`:

```dotenv
API_KEY=dev-secret-change-me
```

`worker/wrangler.toml` configures the D1 binding:

```toml
[[d1_databases]]
binding = "DB"
database_name = "call-log-db"
database_id = "your-database-id"
migrations_dir = "migrations"
```

### Bot

The bot reads configuration from `bot/.env`. `WORKER_API_KEY` must match the
Worker's `API_KEY` value when authentication is enabled.

## Worker API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check |
| `GET` | `/calls?limit=&offset=` | List calls newest first |
| `POST` | `/calls` | Validate and persist a completed call |
| `GET` | `/calls/:id` | Return call, transcript, and metrics |
| `GET` | `/stats` | Return local aggregate dashboard statistics |

### `POST /calls` payload

```json
{
  "id": "optional-call-id",
  "started_at": "2026-01-01T10:00:00Z",
  "ended_at": "2026-01-01T10:01:00Z",
  "duration_seconds": 60,
  "transcript": [
    { "role": "user", "content": "Hi", "timestamp": null },
    { "role": "assistant", "content": "Hello!", "timestamp": null }
  ],
  "metrics": [
    { "stage": "llm", "avg_ms": 250, "max_ms": 400, "samples": 2 }
  ]
}
```

When `API_KEY` is configured, include:

```http
x-api-key: dev-secret-change-me
```

## Performance and optimization

### Real-time audio optimization

- WebRTC carries microphone and speaker audio directly between the browser and
  bot, avoiding an unnecessary media relay in the application server.
- ICE gathering completes before the offer is sent, so the bot receives a
  complete SDP description.
- Silero VAD detects speech boundaries and enables interruption handling.
- Pipecat streams STT, LLM, and TTS stages instead of waiting for a complete
  response before starting audio playback.
- Short spoken system prompts constrain response length and reduce perceived
  latency.
- Provider model, voice, and endpointing values are environment-configurable.

### Database and API optimization

- D1 uses indexes on call start time and transcript call/sequence.
- A completed call is persisted with one `D1.batch()` operation, preventing
  partial call records.
- List queries use bounded `limit` and `offset` values.
- Transcript details are fetched only on the call detail page.
- Worker responses include CORS headers and consistent JSON error bodies.
- The bot sends the final record asynchronously after the WebRTC session ends,
  so the browser does not need to perform database work.

### Frontend optimization

- Next.js uses static export for inexpensive Cloudflare Pages hosting.
- The dashboard fetches data client-side, which keeps deployment independent of
  the Worker origin.
- Tailwind CSS and the local design system provide responsive, utility-first
  styling without a large UI runtime.
- Browser audio and WebRTC objects are cleaned up when calls end or components
  unmount.
- `no-store` API reads keep the call list fresh after a completed session.

## Validation commands

Frontend:

```bash
cd frontend
npm run typecheck
npm run build
```

Worker:

```bash
cd worker
npm run typecheck
npm run db:migrate:local
```

Bot:

```bash
cd bot
python -m py_compile bot.py server.py
```

Basic API checks:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/calls
curl http://localhost:8787/stats
```

## Deployment

### Deploy the Worker and remote D1

```bash
cd worker
npx wrangler login
npx wrangler d1 create call-log-db
# Put the returned database_id in wrangler.toml
npm run db:migrate:remote
npx wrangler secret put API_KEY
npm run deploy
```

### Deploy the static frontend

```bash
cd frontend
NEXT_PUBLIC_API_URL=https://your-worker.workers.dev npm run build
npx wrangler pages project create call-log --production-branch main
npx wrangler pages deploy out --project-name=call-log --branch=main
```

Update the bot configuration for production:

```dotenv
WORKER_URL=https://your-worker.workers.dev
WORKER_API_KEY=the-same-value-as-the-worker-secret
CORS_ORIGINS=https://your-pages-domain.pages.dev,http://localhost:3000
```

The bot can remain on a local machine for development or be deployed to a
server for production. A production deployment should use a TURN server when
clients may be behind restrictive NATs.

## CI/CD

`.github/workflows/deploy.yml` is designed to:

1. Apply remote D1 migrations.
2. Deploy the Worker.
3. Build the static Next.js export.
4. Deploy the `out/` directory to Cloudflare Pages.

Configure these GitHub Actions values:

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Variables: `WORKER_URL`, `PAGES_PROJECT`
- Optional variable: `BOT_URL`

Never commit API keys, `.env` files, `.dev.vars`, or private Cloudflare tokens.

## Observability and troubleshooting

Worker logs are enabled in `worker/wrangler.toml`. View live logs with:

```bash
cd worker
npm run logs
```

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `no such table: calls` | Local D1 migration was not applied | Run `npm run db:migrate:local` |
| `Can't reach the bot` | Bot is stopped or CORS is wrong | Start `python server.py`; check `CORS_ORIGINS` |
| Call connects but no response | Provider key/model/TTS error | Inspect the bot terminal and verify `bot/.env` |
| `model_not_found` from Groq | Retired or unavailable model | Set `GROQ_MODEL` to a model enabled for your Groq account |
| Call saves with a Worker error | API keys do not match | Compare `WORKER_API_KEY` and Worker `API_KEY` |
| Browser microphone failure | Permission or insecure origin | Use localhost/HTTPS and allow microphone access |
| WebRTC connects slowly | NAT or firewall restrictions | Configure TURN for production |

## Design decisions and future work

Current decisions:

- Plain browser WebRTC keeps the media path understandable and dependency-light.
- The bot is the source of truth for transcript and latency data.
- D1 batch writes prevent half-saved calls.
- Static export keeps frontend hosting simple and inexpensive.
- The current metrics represent stage TTFB averages and maxima, not per-turn
  percentiles.

Potential next improvements:

- Add a TURN server and deploy the bot closer to users.
- Add authenticated users and per-user call isolation.
- Add retry/spooling for failed Worker ingestion.
- Capture per-turn latency, interruption counts, and model usage.
- Add automated Worker integration tests and browser E2E tests.
- Replace the legacy Pipecat context adapter when the bot dependency line is
  upgraded deliberately.
