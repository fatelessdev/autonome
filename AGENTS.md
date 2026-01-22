## Autonome - AI Cryptocurrency Trading Platform
Autonome is an AI-powered autonomous cryptocurrency trading platform built with TanStack Start, featuring real-time portfolio analytics, multi AI integration, and a sophisticated trading simulator. The platform supports both live trading (via Lighter API) and simulated trading modes, with comprehensive position management, risk controls, and real-time data visualization.
TanStack Start + React 19 + oRPC + PostgreSQL/Drizzle + AI SDK v6 + Tailwind v4 + Bun + Hono + shadcn/ui.

## Deployment Architecture

The application is split into two deployable units:

1. **Frontend (Vercel)**: TanStack Start SPA at `src/` - deploys to Vercel
2. **Backend (VPS)**: Hono API server at `api/src/index.ts` - runs on VPS

**Communication**: Frontend calls API via oRPC over HTTP. In development, Vite proxies `/api/*` to the API server.

**Port Configuration** (in `.env.local`):
- `PORT` - Backend API server port (default: 8081)
- `FRONTEND_PORT` - Frontend dev server port (default: 5173)
- `VITE_API_URL` - API URL exposed to browser (e.g., `http://localhost:8081`)

Note: `PORT` and `FRONTEND_PORT` are server-side only (read via `process.env`). `VITE_API_URL` is client-exposed (read via `import.meta.env`).


## Team culture

To accomplish this, the team has a shared culture and sense of identity that
drives how they build products. You'll be expected to contribute to this, and
the work you do is critical in helping us drive toward our goals.

### Build less, ship more

It's really important we solve the right problems, than solve lots of problems.
Rather than try to build the most complex feature that covers all cases, we
strive to build precisely the right amount of software to solve the problem
we're currently facing. We're ok with leaving work for "future us" rather than
today. This maxim hopefully prevents us from over engineering solutions that our
3-person development team can't maintain.

### General Rules
- Early development, no users. No backwards compatibility concerns. Do things RIGHT: clean,
organized, zero tech debt. Never create compatibility shims.
- WE NEVER WANT WORKAROUNDS. we always want FULL implementations that are long term
suistainable for many >1000 users. so dont come up with half baked solutions
- Important: Do not remove, hide, or rename any existing features or UI options (even
temporarily) unless I explicitly ask for it. If something isn't fully wired yet, keep the UX
surface intact and stub/annotate it instead of deleting it.

## Critical Rules

1. **Package manager**: Use ONLY `bun` - never npm/pnpm
2. **Data fetching**: oRPC only (`orpc.*.*.queryOptions()`), never REST or raw fetch
3. **Environment**: Use `src/env.ts` (T3Env), never `process.env` directly
4. **Database**: Always quote capitalized identifiers (`"Models"`, `"Orders"`)
5. **Polyfills**: Add `import '@/polyfill'` at top of oRPC router files
6. **No bandaid fixes**: NEVER use workarounds or overrides to fix bugs. Always fix issues at their source/core.
7. **Adaptive refactoring**: When modifying code, if you stumble upon sloppy code even if it's not directly related, refactor that code to improve clarity and maintainability.
8. **Adaptive knowledge**: When working on a feature, familiarize yourself with all related files (e.g. DB schema, oRPC router, events, client code) to ensure holistic understanding and improvements and at the end update this doc with any new insights.
9. **Thorough implementation**: When making changes to a feature, ensure all related aspects (DB schema, oRPC procedures, frontend code, events) are updated accordingly to maintain consistency and functionality.

## Commands

```bash
# Development (run both servers)
bun run dev:all            # Start API + Frontend concurrently
bun run dev:api            # Start API server only (port 8081)
bun run dev                # Start Frontend only (port 5173)

# Production
bun run build              # Build frontend for Vercel
bun run build:api          # Bundle API for VPS
bun run start:api          # Run API server

# Database
bun run db:generate        # Generate migrations after schema changes
bun run db:migrate         # Apply migrations
bun run db:seed            # Reset database and seed with default models

# Other
pnpx shadcn@latest add X   # Add UI component
```

## Architecture

**Deployment Split**:
- `src/` - Frontend (TanStack Start SPA) → Vercel
- `api/src/index.ts` - Backend (Hono API) → VPS

**Data Flow**: Client → `orpc.*.*.queryOptions()` → Hono `/api/rpc/*` → [src/server/orpc/router](../src/server/orpc/router) → [src/server/features](../src/server/features) → DB

**Real-time**: SSE via [api/src/index.ts](../api/src/index.ts) endpoints → clients subscribe → invalidate TanStack Query

**Trading**: Orders table = single source of truth (OPEN=positions, CLOSED=trades). Simulator rehydrates from DB on bootstrap.

## oRPC Procedure Pattern

```typescript
// src/server/orpc/router/*.ts - export from index.ts
import "@/polyfill";
import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";

export const myProcedure = os
  .input(z.object({ field: z.string() }))
  .output(z.object({ result: z.string() }))
  .handler(async ({ input }) => 
    Sentry.startSpan({ name: "myProcedure" }, async () => ({ result: "ok" }))
  );
```

## Client Data Fetching

```typescript
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/server/orpc/client";

const { data } = useQuery(orpc.trading.getPositions.queryOptions({ input: {} }));
```

## Database Schema Rules

- Table names: `"Models"`, `"Orders"` (quoted, capitalized)
- IDs: TEXT (UUID via `$defaultFn(() => crypto.randomUUID())`)
- Money: TEXT → `CAST("netPortfolio" AS NUMERIC)` for math
- Exit plans: JSONB `{ stop, target, invalidation, confidence }`
- Derived values (entryNotional) calculated, not stored

## Key Files

| Purpose | Location |
|---------|----------|
| API Server | [api/src/index.ts](../api/src/index.ts) |
| oRPC router | [src/server/orpc/router/index.ts](../src/server/orpc/router/index.ts) |
| oRPC client | [src/server/orpc/client.ts](../src/server/orpc/client.ts) |
| DB schema | [src/db/schema.ts](../src/db/schema.ts) |
| SSE events | [src/server/events/workflowEvents.ts](../src/server/events/workflowEvents.ts) |
| Environment | [src/env.ts](../src/env.ts) |
| Trading logic | [src/server/features/trading](../src/server/features/trading) |
| Simulator | [src/server/features/simulator](../src/server/features/simulator) |
| Trading calculations | [src/core/shared/trading/calculations.ts](../src/core/shared/trading/calculations.ts) |
| Analytics | [src/server/features/analytics](../src/server/features/analytics) |
| Scheduler bootstrap | [src/server/schedulers/bootstrap.ts](../src/server/schedulers/bootstrap.ts) |

## Shared Utilities

**Trading Calculations** (`@/core/shared/trading/calculations`):
- `calculateUnrealizedPnl()` - P&L from position + current price
- `calculateSharpeRatioFromPortfolio()` - Portfolio NAV-based Sharpe (preferred)
- `calculateSharpeRatioFromTrades()` - Trade P&L-based Sharpe (simplified)
- `calculateReturnPercent()`, `calculateWinRate()`, `calculateExpectancy()`
- `mean()`, `median()`, `standardDeviation()` - Statistical helpers
- `INITIAL_CAPITAL` (10,000) - Constant for return calculations

**Scheduler Initialization**:
- Use consolidated `schedulerState.ts` module for all scheduler globals
- Single `globalThis.__schedulerState` object replaces scattered globals
- `bootstrap.ts` guards with `isBootstrapped()` / `markBootstrapped()`
- Called from API server startup in `api/src/index.ts`

**Shared Variants** (`@/core/shared/variants`):
- `VARIANT_IDS` - SSOT array: `["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian", "Sovereign"]`
- `VariantId`, `VariantIdWithAll` - TypeScript types
- `variantIdSchema`, `variantIdWithAllSchema` - Zod validation
- `VARIANT_CONFIG` - Label, description, color, Tailwind classes per variant
- `getVariantBadgeClasses(variant)` - Returns Tailwind bg + text classes
- `getVariantColor(variant)` - Returns hex color for charts
- `isValidVariantId(value)` - Type guard for variant validation
- `VARIANT_TABS` - Pre-built tab array with "all" option

**Fill Tracking** (`@/server/features/trading/fillTracker`):
- `trackFill()` - Polls exchange for actual fill quantity and average price
- Uses SDK's `waitForTransaction()` and `checkOrderStatus()` utilities
- Falls back to `accountApi.getAccount().trades` if order status unavailable
- Returns `FillResult` with `filledQuantity`, `averagePrice`, `partialFill` flag

**Retention & Downsampling** (`@/server/features/portfolio/retentionService`):
- `RETENTION_CONFIG` - Raw data (7d), hourly-to-daily aggregation (30d) thresholds
- `DOWNSAMPLE_CONFIG` - Time range thresholds and resolution bucket sizes
- `runRetentionPolicy()` - Aggregates old data into hourly/daily buckets
- `downsampleForChart()` - Server-side time-based downsampling with auto-detected resolution
- `getPortfolioHistoryWithResolution()` - Fetches portfolio data with adaptive resolution

## Session Notes

- Shared market price fetching now exposed via `useMarketPrices` (in `marketQueries`); reuse instead of duplicating queries.
- Failures analytics are variant-filterable end-to-end (oRPC `getFailures` accepts `variant`).
- Dashboard UX: crypto tracker has desktop dropdown + mobile pill selector; performance graph shows active variant badge and hides filters on mobile.
- Exposure prompts now use deployed equity (total value minus available cash) via `calculateExposureToEquityPct` to avoid leverage-inflated percentages.
- Portfolio data retention: Use `retentionService.ts` for tiered aggregation (7d raw → hourly → daily). Call `getPortfolioHistoryWithResolution()` for server-side downsampling.
- Portfolio chart downsampling: Server-side time-based downsampling in `downsampleForChart()`. Resolution auto-detected from data range: ≤24h→1min, ≤3d→5min, ≤7d→15min, ≤30d→1hour, >30d→4hour. Aggregate mode averages across all variants per model.
- Server-side variant filtering: All trading queries (`fetchTrades`, `fetchPositions`, `fetchPortfolioHistory`) accept `variant` parameter. Filter at DB level, not client.
- Cache timing tiers: Import from `@/core/shared/cache/cacheConfig.ts`. Use `CACHE_TIMING.REALTIME` (10s), `STANDARD` (60s), `SLOW` (3min), `STATIC` (Infinity).
- Virtual scrolling: Use `@tanstack/react-virtual` for lists with 100+ items. See `trades-tab.tsx` for implementation pattern.
- Server QueryClient: Use `getServerQueryClient()` singleton from `serverQueryClient.ts` for server-side TanStack Query operations. Avoids creating multiple instances.
- Error boundaries: Wrap chart/graph components with `withErrorBoundary` HOC from `error-boundary.tsx` for graceful failure handling.
- Real-time portfolio updates: SSE endpoint at `/api/events/portfolio` emits `portfolio:updated` events. Client subscribes and invalidates `["portfolio", "history"]` query. See `priceTracker.ts` → `emitPortfolioEvent()` → `performance-graph.tsx` SSE subscription.
- SSE auto-reconnect: All frontend SSE connections (`EventSource`) use exponential backoff reconnection (1s, 2s, 4s, ... up to 30s). Prevents permanent disconnection when backend restarts.
- Scheduler health monitoring: Check `/health` for scheduler status. Use `/health/schedulers` for detailed info including last run timestamps and models currently running.
- Scheduler error isolation: All scheduler callbacks wrapped in try-catch to prevent unhandled rejections from stopping the scheduler loops.
- Model stuck detection: Trade scheduler auto-clears models stuck in "running" state for >10 minutes. Tracked via `modelsRunningStartTime` map.
- Execution health tracking: Health endpoint now tracks `lastSuccessfulCompletion`, `lastCycleStats` (success/failure counts), and `consecutiveFailedCycles`. Health is "degraded" if no successful completion in 15 minutes or 3+ consecutive failed cycles.
- NIM API key cycling: Use `getNextNimApiKey()` from `@/env` for round-robin key distribution. Supports `NIM_API_KEY`, `NIM_API_KEY1`, `NIM_API_KEY2`, `NIM_API_KEY3` in `.env.local`.
- Variant SSOT: All variant definitions consolidated in `@/core/shared/variants`. DB schema, oRPC schemas, UI components, and export utilities now import from this module. To add a new variant: add to `VARIANT_IDS`, add config to `VARIANT_CONFIG`, run migrations.
- Scheduler state consolidation: Replaced scattered `globalThis.*` variables with `schedulerState.ts` module. All scheduler state accessed via typed getters/setters (`getTradeState()`, `getPortfolioState()`, `isModelRunning()`, etc.). Health endpoints use `getSchedulerHealth()` and `getSchedulerDetailedHealth()`.
- Variant badge styling: Use `getVariantBadgeClasses(variant)` instead of inline conditionals. Returns combined Tailwind classes like `"bg-purple-500/20 text-purple-600"`.
- Variant validation: Use `isValidVariantId(value)` type guard when parsing unknown variant strings. Safer than hardcoded `.includes()` checks.
- Variant query normalization: Server trading queries normalize `variant` inputs with `isValidVariantId` and use `VARIANT_IDS` to avoid invalid enum values.
- Live fill tracking: `createPosition.ts` and `closePosition.ts` now use `fillTracker.ts` to capture actual fill quantity and average price from exchange. Uses SDK's `waitForTransaction()` + `checkOrderStatus()` with polling. Handles partial fills gracefully.
- Retention config: `RETENTION_CONFIG` and `DOWNSAMPLE_CONFIG` in `retentionService.ts` consolidate all timing thresholds. Modify these constants to adjust data retention/downsampling behavior.
- Realized PnL semantics: Portfolio section shows `scaled_realized_pnl` (cumulative from scaling open positions), Performance section shows `closed_trade_realized_pnl` (cumulative from fully closed trades). Per-position `scaled_realized` shows P&L from partial closes of that position. Use `PerformanceMetrics.closedTradeRealizedPnl` from `performanceMetrics.ts` and `ExposureSummary.totalRealized` from `openPositionEnrichment.ts`.

## Code Style (Biome)

- Indentation: Tabs
- Quotes: Double
- Components: `cva` for variants, `cn()` for className merging
