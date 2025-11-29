## Autonome - AI Cryptocurrency Trading Platform
Autonome is an AI-powered autonomous cryptocurrency trading platform built with TanStack Start, featuring real-time portfolio analytics, multi AI integration, and a sophisticated trading simulator. The platform supports both live trading (via Lighter API) and simulated trading modes, with comprehensive position management, risk controls, and real-time data visualization.
TanStack Start + React 19 + oRPC + PostgreSQL/Drizzle + AI SDK v6 + Tailwind v4 + Bun + shadcn/ui.

## Critical Rules

1. **Package manager**: Use ONLY `bun` - never npm/pnpm
2. **Data fetching**: oRPC only (`orpc.*.*.queryOptions()`), never REST or raw fetch
3. **Environment**: Use `src/env.ts` (T3Env), never `process.env` directly
4. **Database**: Always quote capitalized identifiers (`"Models"`, `"Orders"`)
5. **Polyfills**: Add `import '@/polyfill'` at top of oRPC router files
6. **No bandaid fixes**: NEVER use workarounds or overrides to fix bugs. Always fix issues at their source/core.
7. **Adaptive refactoring**: When modifying code, if you stumble upon sloppy code refactor that code to improve clarity and maintainability.


## Commands

```bash
bun --bun run dev          # Dev server
bun --bun run build        # Production build  
bun run db:generate        # Generate migrations after schema changes
bun run db:migrate         # Apply migrations
pnpx shadcn@latest add X   # Add UI component
```

## Architecture

**Data Flow**: Client → `orpc.*.*.queryOptions()` → [src/server/orpc/router](src/server/orpc/router) → [src/server/features](src/server/features) → DB

**Real-time**: SSE via [src/server/events/workflowEvents.ts](src/server/events/workflowEvents.ts) → `emitAllDataChanged(modelId)` → clients invalidate TanStack Query

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
| oRPC router | [src/server/orpc/router/index.ts](src/server/orpc/router/index.ts) |
| DB schema | [src/db/schema.ts](src/db/schema.ts) |
| SSE events | [src/server/events/workflowEvents.ts](src/server/events/workflowEvents.ts) |
| Environment | [src/env.ts](src/env.ts) |
| Trading logic | [src/server/features/trading](src/server/features/trading) |
| Simulator | [src/server/features/simulator](src/server/features/simulator) |

## Code Style (Biome)

- Indentation: Tabs
- Quotes: Double
- Components: `cva` for variants, `cn()` for className merging
