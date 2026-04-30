# Autonome Walkthrough

This document walks through how Autonome works end-to-end: from configuration to trade execution, position management, and analytics.

---

## 1. System overview

Autonome is an AI cryptocurrency trading platform. Each AI model (e.g., GPT-4o, Claude, Gemini) trades independently on its own Alpaca paper trading account. Models receive market data, portfolio state, and position information via structured prompts, then make trading decisions through tool calls.

**Key principle:** Alpaca is the source of truth for live position state. The database `Orders` table stores lifecycle metadata (entry/exit prices, exit plan, Alpaca order ID).

---

## 2. Configuration

### Environment setup

Copy `.env.example` to `.env.local` and configure:

- `DATABASE_URL` — PostgreSQL connection
- At least one AI provider key (`OPENROUTER_API_KEY`, `NIM_API_KEY`, `AIHUBMIX_API_KEY`, or `MISTRAL_API_KEY`)
- `TAAPI_API_KEY` (optional, for supplementary technical indicators)

### Per-model Alpaca accounts

Each model gets its own Alpaca paper trading account. After running `bun run db:seed`, update each model row in the `Models` table with the model's Alpaca `apiKey` and `apiSecret`. This isolates P&L tracking per model.

### Database schema

Key tables in `src/db/schema.ts`:

| Table | Purpose |
|-------|---------|
| `Models` | AI model config, per-model Alpaca credentials, variant assignment |
| `Invocations` | AI model execution records with response payload (JSONB) |
| `ToolCalls` | Individual tool calls within invocations (CREATE_POSITION, CLOSE_POSITION, HOLDING) |
| `PortfolioSize` | Time-series portfolio snapshots per model |
| `Orders` | Trade lifecycle metadata (OPEN/CLOSED status, entry/exit prices, exit plan) |

---

## 3. The trade cycle

The primary loop lives in `src/server/workflows/tradeCycle.ts`. It's a Workflow DevKit durable workflow that runs continuously:

### Cycle steps

1. **Execute all model trades** (`tradeCycleStep`)
   - For each active model, runs `runTradeWorkflow()` in parallel
   - Each model gets its own Alpaca account context

2. **Reconcile positions** (part of trade cycle)
   - Compares DB `OPEN` orders against Alpaca live positions
   - Orphaned DB orders (Alpaca position already closed) are marked `CLOSED` with `closeTrigger: "RECONCILE"`
   - Logs each reconciliation action

3. **Record portfolio snapshots** (`portfolioSnapshotStep`)
   - Persists current portfolio value to `PortfolioSize` table
   - Updates Welford's running Sharpe ratio state

4. **Retention/downsampling** (`retentionPolicyStep`)
   - Runs every ~12 cycles (~1 hour)
   - Downsamples older snapshots for storage efficiency

5. **Sleep** `TRADE_CYCLE_INTERVAL` (5 minutes), then repeat

---

## 4. How a single model trade works

When `runTradeWorkflow()` executes for a model:

### 4.1 Data gathering

The system fetches:
- **Market data**: OHLCV bars for all traded markets (5min + 4hour timeframes), fetched in parallel across all markets
- **Open positions**: Current positions from Alpaca, enriched with DB metadata
- **Portfolio state**: Current portfolio value, historical performance
- **Market intelligence**: News, open interest (from Binance Futures API), technical indicators (from TAAPI)
- **Correlation matrix**: Rolling 24h Pearson correlations between all active asset pairs
- **Performance metrics**: Win rate, Sharpe ratio, drawdown, total P&L

### 4.2 Prompt building

The prompt system uses variant-based templates:

- **Shared base** (`promptBase.ts`): Common sections shared across all variants
  - Data source hierarchy
  - Tool interface documentation
  - Mandatory exit plan requirements
  - Cooldown rules
  - Portfolio, positions, performance, news, and closing blocks

- **Variant prompts** (sovereign, trendsurfer, contrarian): Strategy-specific content composed with the shared base

Prompts include:
- Current market snapshots with price, volume, and trend data
- Open positions table with **staleness scores** for aged positions
- **Correlation warnings** when r > 0.8 between two assets
- Fee awareness context (~0.1–0.3% round-trip costs)
- Tool reference documentation
- Open interest data (from Binance Futures)

### 4.3 Agent execution

The AI agent (using AI SDK's `ToolLoopAgent`) receives the prompt and can make multiple tool calls:

- **`createPosition`**: Opens a new long/short position
  - Validates minimum trade size ($50)
  - Auto-adjusts if requested size exceeds available balance
  - Submits bracket order to Alpaca (entry + stop loss + take profit)
  - Polls for fill confirmation with exponential backoff (500ms → 1s → 2s → 4s)

- **`closePosition`**: Closes an existing position
  - Cancels pending orders and closes via Alpaca
  - Records exit price and P&L

- **`holding`**: Explicitly decides to hold (no action)

### 4.4 Invocation recording

After the agent completes, the system records:
- The full invocation (prompt + response) in `Invocations`
- Individual tool calls in `ToolCalls`
- Updates model invocation count

### 4.5 Reconciliation

After all models complete their trades, reconciliation runs:
- Fetches all Alpaca positions for the account
- Compares against DB `OPEN` orders using canonical symbol matching
- Closes any orphaned DB orders with `closeTrigger: "RECONCILE"`

---

## 5. Position management

### Position lifecycle

A position goes through these stages:

1. **Decision**: AI agent calls `createPosition` tool
2. **Order submission**: Bracket order (entry + SL + TP) submitted to Alpaca
3. **Fill polling**: System polls for fill confirmation with exponential backoff
4. **OPEN state**: Position is live, tracked in both Alpaca and DB `Orders`
5. **Staleness monitoring**: Position is evaluated for staleness each cycle
6. **Close**: Either the AI decides to close, or reconciliation detects the position was closed externally

### Staleness scoring

The staleness analyzer (`stalenessAnalyzer.ts`) computes a 0–100 composite score:

| Dimension | Max Points | Description |
|-----------|------------|-------------|
| Time held | 40 | Full points at 3+ days, linear from 2–3 days |
| P&L action | 30 | Scaled by loss magnitude; 15pts if held 2+ days with < 3% gain |
| Funding cost | 30 | Accumulated funding cost ratio |

**Grace period:** Positions under 24h are excluded from staleness evaluation.

**Flagging:** Positions with score ≥ 70 OR (held ≥ 3 days AND gain < 5%) are flagged as `STALE` and appear in the prompt's open positions table with a "consider exit" nudge.

### Fill verification

When submitting an order, the system polls for fill confirmation:
- **Backoff schedule:** 500ms, 1s, 2s, 4s (4 attempts total)
- **On success:** Returns fill details immediately
- **On failure:** Logs persistent failure alert after all attempts exhausted

---

## 6. Analytics & monitoring

### Online Sharpe ratio

The Welford service (`welfordService.ts`) maintains per-model running Sharpe ratio:

- Uses Welford's online algorithm for numerically stable running mean/variance
- Computes returns from consecutive portfolio snapshots
- State persists in-memory across trade cycles
- On cold start, reconstructs state from historical `PortfolioSize` snapshots
- Exposed alongside trade-based Sharpe in performance metrics

### Correlation matrix

The correlation matrix (`correlationMatrix.ts`) computes rolling 24h Pearson correlation:

- Uses log-returns of consecutive mid prices from market snapshots
- Computes correlation between all active asset pairs
- When r > 0.8 between two assets both held or considered, a warning is injected into the prompt: "X-Y correlation N.NN — avoid stacking correlated positions"
- Cached per trade cycle

### Open interest

Binance Futures API integration (`src/server/integrations/binance-oi/`):

- Fetches OI for all crypto symbols in parallel
- Includes absolute value and % change in market intelligence cache
- Graceful degradation: returns empty Map on failure (no crash)

### Error deduplication

The error deduplicator (`src/core/lib/errorDeduplicator.ts`):

- Normalizes error messages by stripping numbers, UUIDs, and timestamps
- Deduplicates within a 5-minute sliding window
- First occurrence logs normally; duplicates within window produce a count
- Applied to agent loop error logging in `tradeWorkflow.ts`

---

## 7. Realtime updates

### SSE streams

- **Dashboard stream** (`/api/events/dashboard`): Multiplex endpoint emitting change signals for trades, positions, conversations, and portfolio. Clients invalidate TanStack Query and refetch authoritative data.
- **Workflow stream** (`/api/events/workflow`): Workflow lifecycle events.

### Data flow

1. Trade execution → SSE event emitted
2. Client receives signal → invalidates TanStack Query
3. Client refetches authoritative data from server

SSE payloads are change signals only; queries remain the source of truth.

---

## 8. Cache & timing

### Cache tiers

All cache TTLs use standardized tiers from `cacheConfig.ts`:

| Tier | TTL | Use case |
|------|-----|----------|
| REALTIME | 15s | Positions, prices, live metrics |
| STANDARD | 30s | Trades, conversations, portfolio snapshots |
| SLOW | 60s | Portfolio history, analytics |
| STATIC | 120s | Model list, variant configurations |

### Trade cycle interval

`TRADE_CYCLE_INTERVAL` = 5 minutes. This is the single shared constant used by:
- `tradeCycle.ts` (workflow sleep)
- `dashboardQueries.ts` (refresh interval)
- `alpaca-news/client.ts` (cache TTL and lookback window)

---

## 9. Key file locations

| Area | File |
|------|------|
| Trade cycle workflow | `src/server/workflows/tradeCycle.ts` |
| Trade workflow orchestration | `src/server/features/trading/execution/tradeWorkflow.ts` |
| Position creation | `src/server/features/trading/execution/createPosition.ts` |
| Position closing | `src/server/features/trading/execution/closePosition.ts` |
| Position reconciliation | `src/server/features/trading/reconciliation.ts` |
| Staleness analyzer | `src/server/features/trading/stalenessAnalyzer.ts` |
| Correlation matrix | `src/server/features/trading/analysis/correlationMatrix.ts` |
| Performance metrics | `src/server/features/trading/analysis/performanceMetrics.ts` |
| Welford Sharpe service | `src/server/features/portfolio/welfordService.ts` |
| Prompt builder | `src/server/features/trading/prompting/promptBuilder.ts` |
| Prompt sections | `src/server/features/trading/prompting/promptSections.ts` |
| Shared prompt base | `src/server/features/trading/prompting/prompts/promptBase.ts` |
| Error deduplicator | `src/core/lib/errorDeduplicator.ts` |
| Cache config | `src/core/shared/cache/cacheConfig.ts` |
| Market data | `src/server/features/trading/data/marketData.ts` |
| Market intelligence cache | `src/server/features/trading/data/marketIntelligenceCache.ts` |
| Binance OI integration | `src/server/integrations/binance-oi/` |
| TAAPI integration | `src/server/integrations/taapi/` |
| Alpaca news integration | `src/server/integrations/alpaca-news/` |
| DB schema | `src/db/schema.ts` |
| Env schema | `src/env.ts` |
