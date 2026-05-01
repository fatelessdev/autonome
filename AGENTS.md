# AGENTS.md — Autonome Engineering Handbook

Autonome is an AI cryptocurrency trading platform:
- Frontend: TanStack Start SPA (`src/`) on Vercel
- Backend: Hono API (`api/src/index.ts`) on VPS
- Broker: Alpaca paper trading (per-model account isolation)
- Scheduler: Workflow DevKit durable workflow (`tradeCycle`)

Use this file as the source of truth for coding-agent behavior in this repo.

---

## 1) Non-Negotiable Rules

1. Package manager is `bun` only.
2. Client data fetching uses oRPC + TanStack Query (`orpc.*.*.queryOptions()`), not raw REST fetches.
3. Environment access goes through `src/env.ts` (T3Env), not ad-hoc `process.env` in app code.
4. DB identifiers are capitalized and quoted (`"Models"`, `"Orders"`).
5. Add `import "@/polyfill"` in oRPC router files.
6. No bandaid fixes. Fix root causes.
7. No backward-compatibility shims (early-stage product).
8. Do not remove/hide existing UI features unless explicitly requested.
9. Keep trading/accounting semantics authoritative: Alpaca for live position state, DB Orders for lifecycle metadata.
10. Skill usage is mandatory preflight: identify and load relevant skill files before writing code.
11. Prefer fail-fast behavior across server and UI when required data/contracts are invalid.
12. Do not use silent fallbacks that mask bad shapes or broken invariants in core paths.
13. External API retries are allowed only for transient provider/network failures, with a default budget of 2 retries (3 total attempts) and short exponential backoff.

---

## 2) Current Architecture (as-built)

### Deployment split
- `src/` → frontend SPA
- `api/src/index.ts` → backend API server

### Data flow
- UI → oRPC (`/api/rpc/*`) → server features → DB

### Realtime
- Dashboard uses multiplex SSE endpoint: `/api/events/dashboard`
  - emits change signals for: trades, positions, conversations, portfolio
  - clients invalidate TanStack Query and refetch authoritative data
- Workflow lifecycle stream: `/api/events/workflow`

### Scheduling
- `src/server/workflows/tradeCycle.ts` is the primary loop:
  - execute all model trades via `tradeCycleStep`
  - run position reconciliation (DB ↔ Alpaca sync)
  - record portfolio snapshots (with Welford Sharpe update)
  - retention/downsampling steps
  - sleep `TRADE_CYCLE_INTERVAL` (5 min, shared constant)

### Position lifecycle
- **Reconciliation** (`src/server/features/trading/reconciliation.ts`): after each trade cycle, compares DB OPEN orders against Alpaca live positions. Orphaned DB orders (Alpaca position closed but DB still OPEN) are marked CLOSED with `closeTrigger: "RECONCILE"`.
- **Staleness scoring** (`src/server/features/trading/stalenessAnalyzer.ts`): 0–100 composite score per open position (time held + P&L + funding cost). Positions with score ≥ 70 or held ≥ 3 days with < 5% gain are flagged STALE and injected into the prompt's `OPEN_POSITIONS_TABLE` with a "consider exit" nudge. 24h grace period excludes fresh positions.
- **Fill verification**: exponential backoff polling (500ms → 1s → 2s → 4s, 4 attempts) with persistent failure alert.

### Analytics & intelligence
- **Online Sharpe ratio** (`src/server/features/portfolio/welfordService.ts`): Welford's online algorithm is the **canonical** Sharpe implementation. Computes running Sharpe from portfolio returns. Per-model in-memory state with cold-start bootstrap from historical `PortfolioSize` snapshots. The legacy `calculateSharpeRatioFromPortfolio()` was deleted; `calculateSharpeRatioFromTrades()` was renamed to `tradeSignalToNoiseRatio()` (non-annualized, raw dollar P&L, not a true Sharpe).
- **Advanced analytics** (`src/server/features/analytics/calculations.ts`): profit factor, average R-multiple, decision quality score (Pearson correlation of confidence vs P&L), sortino ratio, calmar ratio, consecutive win/loss streaks, and trade duration distribution. Prompt-facing metrics (profit factor, R-multiple, decision quality, streaks, duration) are injected via `buildPerformanceOverview()`. Analytics-tab-only metrics (sortino, calmar) are excluded from prompts.
- **Correlation matrix** (`src/server/features/trading/analysis/correlationMatrix.ts`): rolling 24h Pearson correlation between all active asset pairs. Warning injected into prompts when r > 0.8 between two assets both held or considered.
- **Open interest** (`src/server/integrations/binance-oi/`): Binance Futures API for crypto OI data (absolute value + % change). Included in market intelligence cache. Graceful degradation on failure.
- **Error deduplication** (`src/core/lib/errorDeduplicator.ts`): normalizes error messages (strips numbers/UUIDs/timestamps), deduplicates within 5-minute sliding window. Applied to agent loop error logging.
- **Decision diary** (`src/server/features/trading/data/decisionDiaryService.ts`): per-invocation structured logging into `DecisionDiary` table. Captures decisions (symbol, side, confidence), market snapshot (ADX, regime, BBands position, supertrend direction), and model state (cash, exposure, portfolio value, open positions). Queryable via oRPC with variant/symbol/date filters.
- **Market state tracker** (`src/server/features/trading/data/decisionDiaryService.ts`): per-cycle market snapshot into `MarketState` table after each trade cycle. Records regime classification (trending/ranging/choppy based on ADX), top movers, active correlations above threshold, and open interest summary. Linked to decision diary via temporal join (nearest prior MarketState for same modelId).

### Cache & timing
- All cache TTLs use `CACHE_TIMING` tiers from `src/core/shared/cache/cacheConfig.ts` (REALTIME=15s, STANDARD=30s, SLOW=60s, STATIC=120s, MARKET=120s). No hardcoded timing values in trading code.
- `TRADE_CYCLE_INTERVAL` (5 min) is the single shared constant — no local `5 * 60 * 1000` definitions.

### TAAPI key rotation
- TAAPI.io provides supplementary technical indicators (BBands, ADX, Supertrend, Ichimoku, VWAP).
- Uses `createApiKeyRotator()` pattern from `src/env.ts` with `TAAPI_API_KEY`, `TAAPI_API_KEY1`, `TAAPI_API_KEY2`, `TAAPI_API_KEY3`.
- Export `getNextTaapiKey()` for round-robin cycling. On free plan (1 req/15s), 3 keys = 1 request/5s effective rate.
- TAAPI client at `src/server/integrations/taapi/client.ts` calls `getNextTaapiKey()` per request.

---

## 3) Agent Workflow (how to change code safely)

When implementing any feature/fix, do this sequence:

0. **Skill activation gate (required before coding)**
   - Identify domains touched by the task (for example: React UI, oRPC contracts, Drizzle, Hono, workflow orchestration, AI SDK).
   - Load and apply relevant skill files before making edits.
   - If no relevant skill exists, state that explicitly and proceed with normal codebase rules.
1. **Map the full surface area first**
   - If touching trading: inspect prompts, tools, workflow step, router, queries, DB writes.
   - If touching UI realtime: inspect SSE producer + event bus + client invalidation.
2. **Implement end-to-end consistency**
   - Update DB schema/types/procedures/client usage together where relevant.
3. **Keep changes surgical**
   - Minimal scope, no unrelated refactors unless directly improving touched code quality.
4. **Validate**
   - `bunx tsc --noEmit`
   - `bun run check`
   - run targeted behavior check for changed flow
5. **Document drift fixes**
   - If you discover stale docs/instructions, update docs in same PR.
   - If you find product/logic problems, append to `problems.md`.

---

## 4) Domain Guardrails

### Broker & position math
- Use Alpaca-provided computed fields when available (`cost_basis`, `market_value`, `unrealized_pl`, etc.).
- Do not recompute broker-derived values unless the API does not provide them.
- Do not add impossible-state guards (e.g., negative `filled_avg_price` checks).

### Symbol normalization
- Normalize all symbol matching through `toCanonical()`.
- Convert outbound broker symbols via `toAlpacaSymbol()`.
- Treat legacy forms (`BTCUSD`, `BTC-USD`, `BTC/USD`) as one canonical symbol.

### Prompts / AI context
- Prefer explicit, complete metrics over compact/inferred formats.
- Zeros are meaningful; `N/A` noise should be omitted where possible.

### SSE behavior
- Prefer one stream per UI concern (currently dashboard multiplex + workflow stream).
- SSE payloads are change signals; queries are source of truth.

### Error handling philosophy
- For required fields and contract violations, throw explicit errors with context rather than defaulting to empty values.
- In UI data flows, prefer explicit error states over partially rendered views based on silent fallback data.
- Keep defensive checks that enforce invariants; remove defensive checks that only hide data-quality bugs.

---

## 5) Coding Conventions

- Biome style:
  - tabs for indentation
  - double quotes
- Use `cn()` for class merges and `cva` for variant-style components.
- Avoid `any` casts where typed interfaces exist (especially Alpaca errors).
- **Spot-only execution**: no leverage anywhere in active code. Positions are sized by quantity, not leverage multipliers.
- **Cache timing**: all TTLs via `CACHE_TIMING` from `cacheConfig.ts`. Never hardcode timing values (`15_000`, `30_000`, etc.) in trading code.
- **Trade cycle interval**: use `TRADE_CYCLE_INTERVAL` from `cacheConfig.ts`. No local `5 * 60 * 1000` definitions.
- **Prompt structure**: shared sections in `promptBase.ts`, composed by each variant (sovereign, trendsurfer, contrarian). Adding a new shared section requires editing exactly one file.
- **Fee awareness**: all prompts include round-trip cost context (~0.1–0.3%) requiring profit targets to exceed fee drag.
- **Staleness scoring**: composite 0–100 score injected into `OPEN_POSITIONS_TABLE`. Positions ≥ 70 or stale-eligible get a "consider exit" nudge in prompts.
- **Position reconciliation**: runs each cycle after trades. Orphaned DB orders closed with `closeTrigger: "RECONCILE"`. Any new position lifecycle change must account for reconciliation.
- **Error deduplication**: use `ErrorDeduplicator` from `@/core/lib/errorDeduplicator` for repeated error suppression. Normalize messages before checking.
- **Correlation warnings**: when implementing features that consider multiple assets, check the correlation matrix. Positions with r > 0.8 should trigger stacking warnings in prompts.

---

## 6) Core Commands

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

---

## 7) Key Files

- API entry: `api/src/index.ts`
- SSE helper: `api/src/sse.ts`
- oRPC router: `src/server/orpc/router/index.ts`
- oRPC client: `src/server/orpc/client.ts`
- Env schema: `src/env.ts`
- DB schema: `src/db/schema.ts`
- Workflow events: `src/server/events/workflowEvents.ts`
- Trading feature root: `src/server/features/trading`
- Alpaca providers: `src/server/providers/alpaca`
- Trade cycle workflow: `src/server/workflows/tradeCycle.ts`
- Trade workflow (decomposed): `src/server/features/trading/execution/tradeWorkflow.ts`
- Workflow steps: `src/server/workflows/steps`
- Market metadata: `src/core/shared/markets/marketMetadata.ts`
- Shared trading calculations: `src/core/shared/trading/calculations.ts`
- Performance metrics: `src/server/features/trading/analysis/performanceMetrics.ts`
- Analytics calculations: `src/server/features/analytics/calculations.ts`
- Shared SSE client util: `src/core/lib/sseConnection.ts`
- Cache config & timing constants: `src/core/shared/cache/cacheConfig.ts`
- Shared prompt base: `src/server/features/trading/prompting/prompts/promptBase.ts`
- Market intelligence formatter: `src/server/features/trading/prompting/marketIntelligenceFormatter.ts`
- Market intelligence cache: `src/server/features/trading/data/marketIntelligenceCache.ts`
- Position reconciliation: `src/server/features/trading/reconciliation.ts`
- Staleness analyzer: `src/server/features/trading/stalenessAnalyzer.ts`
- Correlation matrix: `src/server/features/trading/analysis/correlationMatrix.ts`
- Decision diary service: `src/server/features/trading/data/decisionDiaryService.ts`
- Welford Sharpe service: `src/server/features/portfolio/welfordService.ts`
- Welford algorithm: `src/core/shared/trading/welford.ts`
- Error deduplicator: `src/core/lib/errorDeduplicator.ts`
- Binance OI integration: `src/server/integrations/binance-oi/`
- TAAPI integration: `src/server/integrations/taapi/`
- Orders repository: `src/server/db/ordersRepository.server.ts`
- Variants repository: `src/server/db/variantsRepository.server.ts`
- Trading repository: `src/server/db/tradingRepository.ts`

---

## 8) Definition of Done (for agent PRs)

A change is complete when:
- behavior is correct end-to-end,
- impacted layers are aligned (server/client/types/docs),
- quality checks pass (or unrelated failures are clearly called out),
- docs/instructions are updated if architecture/contracts changed.
