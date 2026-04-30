# Autonome

Autonome is an AI-powered crypto trading platform where each model trades on its own Alpaca paper account, with live dashboard updates and durable 5-minute execution cycles.

## What this repo contains

- Frontend (`src/`): TanStack Start SPA + React 19 + Tailwind v4 + shadcn/ui
- Backend (`api/src/index.ts`): Hono API + oRPC + SSE
- Trading engine (`src/server/features/trading`): prompt orchestration, tools, execution, analytics, reconciliation, staleness scoring
- Scheduler (`src/server/workflows`): Workflow DevKit durable loop
- Data layer (`src/db`, `src/server/db`): Drizzle ORM + PostgreSQL
- Integrations (`src/server/integrations`): Binance OI, TAAPI indicators, Alpaca news

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
  1. Execute all model trades (parallel per model)
  2. Reconcile positions (DB ↔ Alpaca sync, close orphans with `closeTrigger: "RECONCILE"`)
  3. Persist portfolio snapshots (with Welford Sharpe ratio update)
  4. Run retention/downsampling
  5. Sleep `TRADE_CYCLE_INTERVAL` (5 min)

### Position management
- **Reconciliation** (`src/server/features/trading/reconciliation.ts`): matches DB OPEN orders against Alpaca live positions each cycle. Orphaned orders are closed automatically.
- **Staleness scoring** (`src/server/features/trading/stalenessAnalyzer.ts`): 0–100 composite score (time held + P&L + funding cost). Positions ≥ 70 or held ≥ 3 days with < 5% gain are flagged STALE and included in prompts with a "consider exit" nudge.
- **Fill verification**: exponential backoff polling (500ms → 1s → 2s → 4s, 4 attempts) with persistent failure alert.

### Analytics
- **Online Sharpe ratio**: Welford's online algorithm for numerically stable running Sharpe from portfolio returns. Per-model state with cold-start bootstrap from historical snapshots.
- **Correlation matrix**: rolling 24h Pearson correlation between all active asset pairs. Warning injected when r > 0.8 between two assets both held or considered.
- **Open interest**: Binance Futures API for crypto OI (absolute value + % change). Included in market intelligence cache. Graceful degradation on failure.
- **Error deduplication**: normalizes messages (strips numbers/UUIDs/timestamps), deduplicates within 5-minute sliding window.

### Prompt engineering
- **Variant-based prompts**: sovereign, trendsurfer, contrarian — each with strategy-specific content
- **Shared base** (`src/server/features/trading/prompting/prompts/promptBase.ts`): common sections (data source hierarchy, tool interface, exit plan, cooldown, etc.) composed by each variant
- **Fee awareness**: all prompts include round-trip cost context (~0.1–0.3%)
- **Tool reference**: documented tool parameters, return types, and usage constraints
- **Spot-only**: no leverage in any active code

## Tech stack

- Runtime & package manager: Bun
- Frontend: TanStack Start, React 19, Tailwind v4, shadcn/ui
- Backend: Hono, oRPC, Sentry
- DB: PostgreSQL + Drizzle ORM
- AI: AI SDK providers (OpenRouter/NIM/AIHubMix/Mistral)
- Broker: Alpaca Paper API (per-model account isolation)
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
- `DATABASE_URL` — PostgreSQL connection string
- `VITE_API_URL` — API endpoint (default `http://localhost:8081`)
- At least one AI provider API key (`OPENROUTER_API_KEY`, `NIM_API_KEY`, `AIHUBMIX_API_KEY`, or `MISTRAL_API_KEY`)
- `TAAPI_API_KEY` (optional, for supplementary technical indicators)
- After seeding, update each model DB row with Alpaca paper account credentials

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

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `API_URL` | No | API endpoint (default `http://localhost:8081`) |
| `API_PORT` | No | API port (default `8081`) |
| `CORS_ORIGINS` | No | Comma-separated allowed frontend origins |
| `ALPACA_PAPER` | No | `"true"` (default) for paper trading, `"false"` for live |
| `OPENROUTER_API_KEY` | Conditional | OpenRouter API key (one provider required) |
| `NIM_API_KEY` | Conditional | NVIDIA NIM API key (supports up to 4 keys for rotation) |
| `AIHUBMIX_API_KEY` | Conditional | AIHubMix API key (supports up to 6 keys for rotation) |
| `MISTRAL_API_KEY` | No | Mistral API key |
| `TAAPI_API_KEY` | No | TAAPI.io key for supplementary technical indicators |
| `VITE_API_URL` | No | Frontend API URL (default `http://localhost:8081`) |
| `VITE_APP_TITLE` | No | App title (default `Autonome`) |
| `FALLBACK_MODEL` | No | Reasoning-model fallback for single-model competitions |

**Note:** Alpaca credentials are per model and stored in the DB `Models` table (`alpacaApiKey`, `alpacaApiSecret`), not in environment variables. API provider keys support round-robin rotation across multiple keys.

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
- Use `src/env.ts` for env reads (T3Env).
- Keep DB quoted identifier conventions (`"Models"`, `"Orders"`, ...).
- Treat Alpaca as source of truth for live positions; DB Orders are lifecycle metadata.
- Normalize symbols through `toCanonical()` and `toAlpacaSymbol()`.
- Spot-only execution — no leverage anywhere in active code.
- Use `CACHE_TIMING` from `cacheConfig.ts` for all cache TTLs. No hardcoded timing values.
- Use `TRADE_CYCLE_INTERVAL` from `cacheConfig.ts` for cycle timing. No local definitions.

## Key files

- API entry: `api/src/index.ts`
- SSE helper: `api/src/sse.ts`
- oRPC router: `src/server/orpc/router/index.ts`
- Env schema: `src/env.ts`
- DB schema: `src/db/schema.ts`
- Trading core: `src/server/features/trading`
- Reconciliation: `src/server/features/trading/reconciliation.ts`
- Staleness analyzer: `src/server/features/trading/stalenessAnalyzer.ts`
- Correlation matrix: `src/server/features/trading/analysis/correlationMatrix.ts`
- Welford Sharpe: `src/server/features/portfolio/welfordService.ts`
- Error deduplicator: `src/core/lib/errorDeduplicator.ts`
- Cache config: `src/core/shared/cache/cacheConfig.ts`
- Prompt base: `src/server/features/trading/prompting/prompts/promptBase.ts`
- Workflow events: `src/server/events/workflowEvents.ts`
- Workflow loop: `src/server/workflows/tradeCycle.ts`
- Binance OI: `src/server/integrations/binance-oi/`
- SSE client utility: `src/core/lib/sseConnection.ts`

## Notes

- Alpaca credentials are per model and stored in DB model rows (`alpacaApiKey`, `alpacaApiSecret`).
- Crypto symbols are broker-formatted like `BTC/USD`; internal canonical keys are like `BTC`.
- If you're changing architecture/contracts, update this README and `AGENTS.md` in the same PR.
