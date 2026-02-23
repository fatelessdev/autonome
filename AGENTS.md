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
8. **Adaptive knowledge**: When working on a feature, familiarize yourself with all related files (e.g. DB schema, oRPC router, events, client code) to ensure holistic understanding and improvements and at the end update this doc (AGENTS.md) with any new insights. And if you find any issues in the process of completing a task update problems.md.
9. **Thorough implementation**: When making changes to a feature, ensure all related aspects (DB schema, oRPC procedures, frontend code, events) are updated accordingly to maintain consistency and functionality.
10. **Critical Alignment**: Do not blindly follow instructions. Always evaluate the intent of the request against the existing codebase. If a request feels "off," partial, or doesn't solve the root user problem, you must explicitly point this out—even if it means correcting the user. Your engineering judgment is required; do not be a passive coder.
11. **Edge Case Exhaustion**: Before finalizing any code, strictly "stress test" your solution mentally. Recursively generate failure scenarios and fix them immediately. Do not stop until you cannot find a way for the code to fail. Do not wait for a review to catch these; catch them yourself now.
12. **No Defensive Bloat**: Do not write defensive code for problems that don't exist. If a data structure already handles something correctly, don't add cleanup/validation for it. If the user suggests a potential problem, first verify if it's actually a problem before writing code. Point out when suggested fixes are unnecessary.
13. **Complete Data for AI Prompts**: When building prompts for AI agents, include ALL relevant metrics explicitly. Never assume the AI can infer or calculate values. If you think about adding a metric, add it. Explicit labels > compact formats. Zeros are meaningful (show them), N/A values are noise (omit them). Token cost is not a concern—clarity and completeness are.


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
- `calculateMaxDrawdown()`, `calculateCurrentDrawdown()` - Drawdown metrics
- `mean()`, `median()`, `standardDeviation()` - Statistical helpers
- `INITIAL_CAPITAL` (10,000) - Constant for return calculations

**API Key Rotators** (`@/env`):
- `getNextNimApiKey()` - Retrieves the next Nim API key
- `getNextOpenRouterApiKey()` - Retrieves the next Open Router API key
- `getNextAihubmixApiKey()` - Retrieves the next Aihubmix API key
- `getNimApiKeyCount()` - Returns the count of Nim API keys
- `getOpenRouterApiKeyCount()` - Returns the count of Open Router API keys
- `getAihubmixApiKeyCount()` - Returns the count of Aihubmix API keys

**Trading Prompts** (`@/server/features/trading/prompts`):
- Variant-specific prompts: `apex.ts`, `sovereign.ts`, `trendsurfer.ts`, `contrarian.ts`
- Each exports `SYSTEM_PROMPT` (static instructions) and `USER_PROMPT` (dynamic data template)
- `promptBuilder.ts` - Assembles prompts with template replacements (`{{PLACEHOLDER}}`)
- `promptSections.ts` - Builds PORTFOLIO, PERFORMANCE, OPEN POSITIONS sections

**Prompt Data Principles**:
- **Spoon-feed data**: AI should never infer or calculate - provide all metrics explicitly
- **Explicit labels**: `risk_usd $128.56` not `risk $128.56` - no ambiguity
- **Show zeros**: `scaled_realized $0.00` is meaningful (no partial closes yet)
- **Omit N/A**: If data doesn't exist, don't show it (noise reduction)
- **No token optimization**: Clarity > brevity. Full descriptive labels always.
- **Section separation**: Header (session), PORTFOLIO (current state), PERFORMANCE (historical), OPEN POSITIONS (per-position)
- **No duplication**: Each metric lives in exactly one section

**Scheduler Initialization**:
- Use consolidated `schedulerState.ts` module for all scheduler globals
- Single `globalThis.__schedulerState` object replaces scattered globals
- `bootstrap.ts` guards with `isBootstrapped()` / `markBootstrapped()`
- Called from API server startup in `api/src/index.ts`

**Shared Variants** (`@/core/shared/variants`):
- `VARIANT_IDS` - SSOT array: `["Apex", "Trendsurfer", "Contrarian", "Sovereign"]`
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

## Code Style (Biome)

- Indentation: Tabs
- Quotes: Double
- Components: `cva` for variants, `cn()` for className merging
