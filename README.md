# Virtual Lab Assistant

A conversational AI assistant for electrical-engineering students using Rohde & Schwarz lab instruments. Built for **Track 2 — AI-Assisted Onboarding** at the KNUST x Rohde & Schwarz AI-assisted onboarding hackathon.

The assistant speaks and listens, walks students through measurement setups, and enforces safety limits on instrument state changes through a confirmation-gate flow.

---

## Features

- **Conversational chat** — Streaming text conversation with a LangChain agent that has instrument-control tools and a web-research subagent.
- **Voice input (mic button)** — Tap the mic, speak, tap again. Audio is transcribed via Deepgram Nova-3 and inserted as a chat message.
- **Voice Mode (hands-free loop)** — Press "Voice Mode" and converse hands-free. Raw PCM audio flows through a local WebSocket proxy to Deepgram Flux STT; responses are spoken back via Deepgram Aura-2 TTS.
- **Confirmation-gate flow** — State-changing instrument actions (set voltage, change coupling, etc.) render an inline confirmation card. The user must tap **Confirm** before the change executes. If the requested value exceeds a safety threshold, the card shows a prominent warning and blocks the Confirm button.
- **Instrument-state cards** — Read-only tool calls (e.g. checking a channel's current config) render a structured panel with formatted instrument readouts.
- **Chat persistence** — Conversations are saved to a Neon Postgres database and survive page reloads.
- **Auto-generated titles** — Every conversation gets a title generated automatically from its content.
- **Thread list** — Sidebar with recent threads; rename or delete from context menus.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS v4, shadcn/ui |
| Chat UI | assistant-ui (`@assistant-ui/react`, `@assistant-ui/react-ai-sdk`, `@assistant-ui/react-markdown`) |
| LLM Orchestration | LangChain (`@langchain/core`, `@langchain/langgraph-sdk`) + DeepAgents |
| LLM Provider | Inception Labs Mercury-2 (via OpenAI-compatible API) |
| Streaming Adapter | `@ai-sdk/langchain-adapter` + `@ai-sdk/react` |
| Database | Neon Postgres via Prisma ORM |
| Auth | Clerk (`@clerk/nextjs`) |
| Voice STT | Deepgram Nova-3 (mic button) + Deepgram Flux (Voice Mode) |
| Voice TTS | Deepgram Aura-2 |
| Web Search | Tavily (research subagent) |
| Embeddings | Cohere |

---

## Setup

### Prerequisites

- **Node.js** ≥ 18 (no engine constraint in `package.json`, but Next.js 16 requires ≥ 18)
- **pnpm** (the project uses `pnpm` — do not use `npm` or `yarn`)
- A **Neon Postgres** database (free tier works)
- API keys for the services listed below

### 1. Clone and install

```bash
git clone <repo-url>
cd viratullabassistant
pnpm install
```

### 2. Environment variables

Copy the template below into `.env.local` (the app reads both `.env` and `.env.local`; `.env.local` takes precedence):

```env
# LLM Provider (Primary)
INCEPTION_API_KEY=     # https://inceptionlabs.ai

# LLM Provider (Fallback — uncomment in agent/model.ts to activate)
OPENAI_API_KEY=        # https://platform.openai.com
MINIMAX_API_KEY=       # https://platform.minimaxi.com

# Voice (Deepgram)
DEEPGRAM_API_KEY=      # https://console.deepgram.com

# Web Search (Research Subagent)
TAVILY_API_KEY=        # https://tavily.com

# Embeddings (Cohere)
COHERE_API_KEY=        # https://dashboard.cohere.com

# Database (Neon Postgres)
DATABASE_URL=          # postgresql://... from Neon dashboard
DIRECT_URL=            # same connection string (used by Prisma for migrations)

# Auth (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=  # From Clerk dashboard
CLERK_SECRET_KEY=                   # From Clerk dashboard
CLERK_WEBHOOK_SECRET=               # From Clerk dashboard (webhook signing secret)
```

> All of these are referenced in the codebase. Missing keys will cause runtime errors at the corresponding feature boundary.

### 3. Database setup

```bash
# Generate the Prisma client
npx prisma generate

# Push the schema to your Neon database
npx prisma db push
```

The schema includes three models: `User` (synced via Clerk webhook), `Thread` (conversations with auto-generated titles), and `Message` (per-thread messages with metadata).

### 4. Run locally (two terminals required)

```bash
# Terminal 1: WebSocket proxy server (required for Voice Mode)
npx tsx ws-server.ts

# Terminal 2: Next.js dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Clerk, and start a conversation.

> The mic button (single-tap STT) only needs the Next.js server. Voice Mode needs both.

---

## Instrument Connection

### Current: In-memory mock

This build uses a **lightweight in-memory mock** of an oscilloscope and signal generator rather than live R&S hardware. This was a deliberate scope decision for the hackathon timeline: it eliminates hardware-dependency issues, makes the demo reliably reproducible on any machine, and lets us focus on the AI-Assisted Onboarding interaction patterns.

The mock state is managed in **`lib/instrument-state.ts`** and tracks:

| Instrument | State |
|-----------|-------|
| Oscilloscope (4 channels) | Coupling (DC/AC/GND), voltage range (V/div), timebase (s/div), probe attenuation |
| Signal generator | Waveform type (Sine/Square/Triangle/Sawtooth), frequency, amplitude (Vpp), DC offset |

**Write tools** (require confirmation gate):

- `set_channel_coupling` — CH1–CH4 coupling mode
- `set_voltage_range` — CH1–CH4 volts-per-division
- `set_timebase` — Horizontal timebase
- `set_generator_frequency` — Signal generator frequency
- `set_generator_amplitude` — Signal generator amplitude
- `set_generator_waveform` — Signal generator waveform type
- `reset_instruments` — Factory reset both instruments

**Read tools** (render instrument-state card):

- `get_instrument_state` — Full state of both instruments
- `get_channel_config` — Single oscilloscope channel configuration

### Connecting real R&S instruments

To point this at real hardware, replace the mock functions in `lib/instrument-state.ts` with calls to the R&S instrument API (VISA / Socket / HTTP), keeping the same tool function signatures. The tools in `agent/instrument-tools.ts` and the Tool UI components need no changes — they consume whatever state the backing functions return.

---

## Safety Design

The confirmation-gate flow is the core safety mechanism:

1. When the agent calls a state-changing tool, the **tool execution is suspended** on the backend.
2. The frontend renders a **confirmation card** (via `@assistant-ui/react` Tool UI) showing: the proposed action in plain language, the current value, the requested new value, and the agent's stated reason.
3. If the requested value exceeds a **safety threshold** (e.g. voltage > 10 V/div, frequency > 20 MHz), the card displays a red warning and **disables the Confirm button** — the user cannot approve a dangerous value through the UI.
4. The user taps **Confirm** to allow the change or **Cancel** to reject it.
5. On Confirm, the tool executes and the instrument state updates. On Cancel, the agent acknowledges and asks for alternative instructions.

Safety thresholds are defined inline in `agent/instrument-tools.ts` alongside each tool's parameter validation.

---

## Demo Flow

Both scenarios assume the app is running at `http://localhost:3000` with a signed-in user.

### Scenario 1: Measurement guidance (simple)

1. Type: *"I need to measure a 5 MHz, 3 Vpp sine wave on CH1. What settings should I use?"*
2. The agent responds with guidance, then calls `set_channel_coupling("CH1", "DC")`.
3. A confirmation card appears. Tap **Confirm**.
4. The agent calls `set_voltage_range("CH1", "1.0")` and `set_channel_coupling("CH2", "GND")` (to disable the unused channel). Confirm each.
5. Then calls `set_timebase("100.0e-9")` (100 ns/div). Confirm.
6. The agent summarises the setup and asks if you're ready to probe.

### Scenario 2: Safety threshold block

1. Type: *"Set CH1 voltage range to 50 V/div on 1X probe."*
2. The agent calls `set_voltage_range("CH1", "50")`.
3. A confirmation card appears with a **red warning badge**: "Safety threshold exceeded (max 10 V/div for 1X probe)".
4. The **Confirm button is disabled**.
5. The agent acknowledges the block and says something like: *"That range exceeds the safety limit for a 1X probe. Try a 10X probe instead, which supports up to 100 V/div. Or reduce the input voltage."*
6. Type: *"OK, use 10X and set it to 20 V/div"* — the agent now calls `set_probe_attenuation("CH1", 10)` and `set_voltage_range("CH1", "20")`.

---

## Deploy to Railway

This project is designed to run on **Railway** (not Vercel) because Voice Mode requires a persistent WebSocket server, which Vercel's serverless architecture doesn't support.

### Architecture

The deployment uses two services within a single Railway project:

| Service | Build command | Start command |
|---------|---------------|---------------|
| **Web App** (Next.js) | `prisma generate && next build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/` | `node .next/standalone/server.js` |
| **WebSocket Proxy** | (none — uses Nixpacks auto-detection) | `npx tsx ws-server.ts` |

### Steps

1. Push the repo to GitHub.
2. Create a new project on [Railway](https://railway.app) → Deploy from GitHub repo.
3. Railway auto-detects the Next.js app. Add a second service for the WebSocket proxy (use the same repo, set start command to `npx tsx ws-server.ts`).
4. Add the following environment variables to **both** services:

```env
INCEPTION_API_KEY=
DEEPGRAM_API_KEY=
DATABASE_URL=
DIRECT_URL=
TAVILY_API_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
```

5. On the Web App service, navigate to **Settings → Deploy → Pre-deploy Command** and set:
   ```
   npx prisma migrate deploy
   ```
6. Generate a public domain for both services in their **Networking** tab.
7. Copy the WebSocket proxy's public URL and add it as an environment variable on the Web App service:
   ```env
   NEXT_PUBLIC_VOICE_WS_URL=wss://your-ws-proxy-url.railway.app
   ```
   This tells the browser where to find the WebSocket server in production.
8. Redeploy the Web App service so the new env var takes effect.

> **Note:** The `NEXT_PUBLIC_VOICE_WS_URL` is only needed in production. Locally, the adapter defaults to `ws://localhost:3001/ws` automatically.

---

## Known Limitations & Scope Decisions

- **Voice barge-in** — Playback is not interrupted when the user starts speaking (not implemented for hackathon scope; would require a separate VAD + interrupt signal).
- **No AR overlay** — The brief considered AR guidance but was scoped out due to hardware setup complexity and time constraints.
- **No full instrument simulator microservice** — The mock is in-process and intentionally simple. A full simulator with network-addressable VISA/SCPI endpoints was out of scope.
- **No RAG over procedure docs** — The agent's domain knowledge (measurement procedures, safety guidelines) is **system-prompt-grounded** rather than retrieved from a vector store. This keeps the agent's knowledge consistent without adding retrieval infrastructure.
- **Chat history is untyped** — The `Message.content` field in the database stores JSON blobs; there's no structured query layer over past conversations.
