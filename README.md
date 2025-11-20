# Getting Started

# Autonome

github-link = "https://github.com/fatelessdev/autonome"

Autonome is an AI-powered autonomous cryptocurrency trading platform that blends TanStack Start, multi-provider AI strategies, and a high-fidelity trading simulator for both live and sandbox execution. This README is tailored for the HUSHH TC.40779.2027.55355 / TC.40779.2026.55243 Round-2 submission process and documents everything evaluators need to reproduce, review, and extend the project.

## Table of Contents
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Core Features](#core-features)
- [Setup & Run](#setup--run)
- [Environment Variables](#environment-variables)
- [Database & Data Models](#database--data-models)
- [APIs & Integrations](#apis--integrations)
- [Testing & Quality](#testing--quality)
- [Deployment](#deployment)
- [Impact & Metrics](#impact--metrics)
- [Whats Next](#whats-next)

## Tech Stack
| Layer | Technologies |
| --- | --- |
| Framework & Runtime | TanStack Start (React 19, SSR), Vite w/ TanStack Router plugin, Bun package/runtime |
| Styling & UI | Tailwind CSS v4, shadcn/ui, Lucide icons, GSAP micro-interactions |
| Data & State | TanStack Query + oRPC, EventSource (SSE), React Store, cva utilities |
| Backend | Node/Bun server, oRPC procedures, Sentry tracing, Exchange Simulator, schedulers |
| Database | PostgreSQL + Drizzle ORM (quoted identifiers, repository pattern) |
| AI & Trading Integrations | AI SDK v6 (Anthropic Claude primary, Google, OpenAI, Mistral, NVIDIA NIM), Lighter REST API SDK |
| Tooling | Biome (lint/format), Vitest, T3Env, tsx, dotenv, Sentry |

## Architecture

![alt text](https://github.com/fatelessdev/autonome/public/architecture.png)

- **Client** renders TanStack Start routes, reusing `orpc.*.*.queryOptions` for data fetching and SSE streams (`/api/events/*`) for live updates.
- **Server** exposes only oRPC endpoints (`src/routes/api/rpc.$.ts`) backed by domain modules under `src/server/features/**`. Schedulers bootstrap once per process via `instrument.server.mjs` + `ExchangeSimulator`.
- **Data** persists in PostgreSQL using Drizzle with quoted identifiers (`"Models"`, `"netPortfolio"`) and repository helpers. Read-only SQL tooling is enforced through AI assistant guardrails.
- **Integrations** include the generated Lighter SDK for real market access, AI SDK multi-provider orchestration, and EventEmitter-backed SSE broadcasters for UI reactivity.

## Core Features
- **Autonomous Trading Loop** – AI agents evaluate market data, craft trade/exit decisions, and route them via simulator or Lighter live endpoints with risk controls.
- **AI Co-Pilot Chat** – Model chat tab shows reasoning, tool calls, exit updates, and their execution status with markdown and decision badges.
- **Trading Simulator** – ExchangeSimulator mimics latency, slippage, maker/taker fees, and funding to validate strategies offline.
- **Positions & Trades Dashboard** – Unified sidebar with filters, net PnL summaries, exit plan visualization, and streaming updates.
- **Multi-Provider AI Stack** – Anthropic Claude primary with fallbacks to Google, OpenAI, Mistral, and NVIDIA NIM for SQL planning.
- **Safety Rails** – Read-only SQL enforcement, Sentry spans, environment-guarded scheduler bootstrap, and typed env access via T3Env.

## Setup & Run

### Prerequisites
- Bun >= 1.1 and Node 18+ (Bun drives package scripts)
- PostgreSQL 15+ (local or hosted)
- Lighter API credentials (or simulator mode)

### Steps
1. **Install deps**
   ```bash
   bun install
   ```
2. **Configure env**
   ```bash
   cp .env.example .env
   # fill in API keys, database URL, etc.
   ```
3. **Prepare database**
   ```bash
   bun run db:generate   # after schema tweaks
   bun run db:migrate    # apply migrations
   ```
4. **Run dev server**
   ```bash
   bun run dev           # Vite + scheduler bootstrap
   ```
5. **Production build & start**
   ```bash
   bun run build
   bun run start
   ```

Common helper scripts:

| Command | Purpose |
| --- | --- |
| `bun run lint` / `bun run format` / `bun run check` | Biome linting, formatting, lint+type combo |
| `bun run test` | Vitest suite (unit + domain tests) |
| `bun run db:studio` | Launch Drizzle Studio to inspect live schema |
| `bun run scripts/validate-env.ts` | Verify mandatory environment configuration (new) |

## Environment Variables
All secrets are typed through `src/env.ts`. Copy `.env.example` and fill the following:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SERVER_URL` | Public server origin (optional, used for callbacks) |
| `TRADING_MODE` | `live` or `simulated`; toggles ExchangeSimulator |
| `IS_SIMULATION_ENABLED` | Mirror flag for client deployments (string `true`/`false`) |
| `LIGHTER_API_KEY_INDEX` | Selects credential slot in zkLighter account (default 2) |
| `LIGHTER_BASE_URL` | Lighter REST endpoint base |
| `SIM_*` vars | Configure simulator capital, fees, latency, funding cadence |
| `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `NIM_API_KEY` | Provider auth tokens |
| `VITE_SENTRY_DSN` | Browser Sentry DSN (must be prefixed with `VITE_`) |
| `VITE_APP_TITLE` | Optional UI title override |

## Database & Data Models
- **ORM**: Drizzle with quoted identifiers; see `db/schema.ts` for `"Models"`, `"Trades"`, `"PortfolioSnapshots"`, etc.
- **Repository Pattern**: Query helpers under `src/server/db/**` expose typed data loaders consumed by oRPC procedures.
- **Key Domain Rules**
  - Monetary fields such as `"netPortfolio"` are stored as `TEXT`; cast to `NUMERIC` for analytics (`CAST("netPortfolio" AS NUMERIC)`).
  - IDs are `TEXT` (not UUID). Avoid implicit type casts when joining.
  - All AI-generated SQL is funneled through `queryPortfolioSql` and guarded by `enforceReadOnly`.
- **Migrations**: Generated via `drizzle-kit` into `drizzle/` and executed with the `db:*` scripts listed above.

## APIs & Integrations
- **oRPC Router (`src/server/orpc/router`)**
  - `trading.*`: trades, positions, crypto prices, portfolio history.
  - `models.*`: AI model metadata, invocation history.
  - `simulator.*`: place/reset orders, account snapshots, historical trades.
  - `chat`: model reasoning stream with SQL tooling.
- **SSE Streams**
  - `/api/events/trading` – real-time position updates.
  - `/api/events/trades` – execution feed.
  - `/api/events/conversations` – AI chat events.
- **External Services**
  - `lighter-sdk-ts` generated client for zkLighter REST API.
  - AI SDK v6 multi-provider stack (Anthropic, Google, OpenAI, Mistral, NVIDIA NIM).
  - Sentry instrumentation covering both router and server spans.

## Testing & Quality
- **Vitest** for unit/integration tests (`bun run test`).
- **Biome** enforces tabs, double quotes, and max line width 80.
- **Type Safety** through strict TypeScript config and Zod validation on every oRPC input/output.
- **Manual QA Playbook**
  - Run `bun run dev` with `TRADING_MODE=simulated` to exercise ExchangeSimulator.
  - Trigger `scripts/validate-env.ts` before deployments to catch missing secrets.

## Deployment
- Build with `bun run build` (Vite + SSR bundle) and start via `bun run start`, which reuses `instrument.server.mjs` to bootstrap schedulers in production.
- Deployable on any Bun-compatible host (Render, Fly.io, custom VM). Provide `DATABASE_URL`, provider keys, and `SERVER_URL` per environment. Ensure SSE endpoints stay behind HTTPS for production.

## Impact & Metrics
- **Latency**: SSE updates every 3s for price refresh; simulator latency randomized between 40–250 ms to mimic exchange fills.
- **Caching**: TanStack Query caches volatile data 15s–5min, balancing responsiveness with API quotas.
- **Resilience**: Schedulers guard against duplicate bootstrap via global flag; errors are traced in Sentry for root-cause analysis.
- **Scalability**: oRPC procedures are stateless and pool DB connections; trading simulators/spans can run horizontally per process.