# Autonome

Autonome is an AI-powered crypto trading platform where each model trades on its own Alpaca paper account, with live dashboard updates and durable 5-minute execution cycles.

## What this repo contains

- Frontend (`src/`): TanStack Start SPA + React + Tailwind
- Backend (`api/src/index.ts`): Hono API + oRPC + SSE
- Trading engine (`src/server/features/trading`): prompt orchestration, tools, execution, analytics
- Scheduler (`src/server/workflows`): Workflow DevKit durable loop
- Data layer (`src/db`, `src/server/db`): Drizzle ORM + PostgreSQL

## Architecture

### Deploy split
- **Frontend**: Vercel deployment from `src/`
- **Backend**: VPS process from `api/src/index.ts`

### Data flow
- UI → oRPC query/mutation → `/api/rpc/*` → server features → DB

### Realtime
- `/api/events/dashboard` (multiplex change signals): trades, positions, conversations, portfolio
- `/api/events/workflow`: workflow lifecycle events
- Clients receive signals and invalidate TanStack Query; queries remain source of truth

### Trading loop
- Workflow: `src/server/workflows/tradeCycle.ts`
- Every cycle:
  1. execute all model trades
  2. persist portfolio snapshots
  3. run retention/downsampling
  4. sleep 5 minutes

## Tech stack

- Runtime & package manager: Bun
- Frontend: TanStack Start, React 19, Tailwind v4, shadcn/ui
- Backend: Hono, oRPC, Sentry
- DB: PostgreSQL + Drizzle ORM
- AI: AI SDK providers (OpenRouter/NIM/others)
- Broker: Alpaca Paper API
- Workflow engine: Workflow DevKit

## Quick start

### 1) Install
```bash
bun install
```

### 2) Configure env
```bash
cp .env.example .env.local
```

Set at minimum:
- `DATABASE_URL`
- `VITE_API_URL`
- provider API keys

### 3) Prepare DB
```bash
bun run db:migrate
bun run db:seed
```

### 4) Run
```bash
bun run dev:all
```

Or separately:
```bash
bun run dev:api
bun run dev
```

## Core scripts

```bash
# Dev
bun run dev:all
bun run dev:api
bun run dev

# Build
bun run build
bun run build:api
bun run start:api

# DB
bun run db:generate
bun run db:migrate
bun run db:seed

# Quality
bunx tsc --noEmit
bun run check
bun run test
```

## Operational guardrails

- Use `bun` only.
- Use oRPC + TanStack Query for client data access (no ad-hoc REST fetches).
- Use `src/env.ts` for env reads.
- Keep DB quoted identifier conventions (`"Models"`, `"Orders"`, ...).
- Treat Alpaca as source of truth for live positions; DB Orders are lifecycle metadata.
- Normalize symbols through `toCanonical()` and `toAlpacaSymbol()`.

## Key files

- API entry: `api/src/index.ts`
- SSE helper: `api/src/sse.ts`
- oRPC router: `src/server/orpc/router/index.ts`
- Env schema: `src/env.ts`
- DB schema: `src/db/schema.ts`
- Trading core: `src/server/features/trading`
- Workflow events: `src/server/events/workflowEvents.ts`
- Workflow loop: `src/server/workflows/tradeCycle.ts`
- SSE client utility: `src/core/lib/sseConnection.ts`

## Notes

- Alpaca credentials are per model and stored in DB model rows (`alpacaApiKey`, `alpacaApiSecret`).
- Crypto symbols are broker-formatted like `BTC/USD`; internal canonical keys are like `BTC`.
- If you’re changing architecture/contracts, update this README and `AGENTS.md` in the same PR.
