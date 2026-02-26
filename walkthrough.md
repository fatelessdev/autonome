# Autonome Walkthrough (Alpaca Migration)

## Overview
Autonome is an AI crypto trading platform using Alpaca paper accounts as the only execution backend.

- Frontend: TanStack Start SPA in `src/`
- API: Hono server in `api/src/index.ts`
- Trading: Alpaca provider stack in `src/server/providers/alpaca/`
- Scheduler: Workflow DevKit durable workflow in `src/server/workflows/tradeCycle.ts`

## Trading Architecture
All model execution flows through Alpaca.

1. Workflow step triggers model trade cycle.
2. Trading agent collects market data and model context.
3. Orders are submitted through `getTradingProvider(...)`.
4. Open positions and portfolio are read from Alpaca APIs.
5. Order lifecycle metadata is stored in DB `"Orders"`.
6. Portfolio snapshots are recorded for analytics and charts.

## Analytics Source Of Truth
Analytics uses:

- Alpaca account and portfolio history for equity and drawdown context.
- DB closed orders for realized PnL and trade lifecycle stats.
- Shared calculation utilities in `src/core/shared/trading/calculations.ts`.

There is no legacy fallback path in analytics calculations.

## Realtime Updates
Dashboard updates come from SSE change signals.

- Endpoint: `/api/events/dashboard`
- Event types: trades, positions, conversations, portfolio changes
- Clients invalidate TanStack Query keys and refetch authoritative data

## Key Files
- `src/server/features/trading/createPosition.ts`
- `src/server/features/trading/closePosition.ts`
- `src/server/features/trading/openPositions.ts`
- `src/server/features/trading/getPortfolio.ts`
- `src/server/features/trading/performanceMetrics.ts`
- `src/server/features/analytics/queries.server.ts`
- `src/server/features/analytics/calculations.ts`
- `src/server/workflows/tradeCycle.ts`

## Validation Commands
Run after migration changes:

```bash
bunx tsc --noEmit
bun run check
```

If these pass, the Alpaca-only transition is aligned across trading and analytics layers.
