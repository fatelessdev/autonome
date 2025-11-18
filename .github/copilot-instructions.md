## Project Overview

Autonome3 is an AI-powered autonomous cryptocurrency trading platform built with TanStack Start, featuring real-time portfolio analytics, multi-model AI integration, and a sophisticated trading simulator. The platform supports both live trading (via Lighter API) and simulated trading modes, with comprehensive position management, risk controls, and real-time data visualization.

## Core Technology Stack

- **Framework**: TanStack Start with React 19, TypeScript (strict mode), and file-based routing
- **Styling**: Tailwind CSS v4, shadcn/ui components, Lucide icons
- **Database**: PostgreSQL with Drizzle ORM and connection pooling
- **Data Fetching**: TanStack Query with oRPC integration, aggressive caching (15s-5min based on volatility)
- **RPC**: oRPC with TanStack Query utils for type-safe, end-to-end procedures
- **AI Integration**: AI SDK v6 with multi-provider support (Anthropic Claude primary, plus Google, OpenAI, Mistral, NVIDIA NIM)
- **Trading**: Lighter REST API (zkLighter.elliot.ai) with auto-generated TypeScript SDK
- **Real-time**: Server-Sent Events (SSE), WebSocket fallback, EventEmitter-based publishers
- **Build**: Vite with TanStack Router plugin, SSR support
- **Quality**: Biome (linting/formatting), Vitest (testing), Sentry (monitoring)
- **Environment**: T3Env for type-safe configuration

## Directory Structure

```
src/
├── routes/                     # File-based routing (TanStack Router)
│   ├── __root.tsx             # Root layout with Providers, theme, toast, devtools
│   ├── api/                   # API endpoints (rpc.$.ts, events/*)
│   ├── chat.tsx              # AI portfolio analytics interface
│   └── simulator.tsx         # Exchange control room
├── components/
│   ├── ui/                   # shadcn/ui primitives (use pnpx shadcn@latest add)
│   ├── ai-elements/          # AI SDK components (conversations, messages, reasoning)
│   ├── trades-sidebar/       # Trading-specific widgets
│   └── providers.tsx         # Theme, toast, and global providers
├── server/
│   ├── features/             # Domain logic (trading, simulator, integrations)
│   ├── db/                   # Repository pattern with query definitions
│   ├── ai/                   # AI tools, prompts, SQL assistant
│   ├── orpc/                 # Type-safe RPC endpoints (router.ts, client.ts)
│   └── schedulers/           # Bootstrap.ts for ExchangeSimulator and trading schedulers
├── db/
│   ├── schema.ts             # Drizzle schema with quoted identifiers
│   └── index.ts              # Database connection
├── hooks/                    # Data fetching hooks (usePollingFetch pattern)
├── styles.css                # Global styles + Tailwind
└── env.ts                    # T3Env configuration (never use process.env directly)
lighter-sdk-ts/               # Generated Lighter API client
drizzle/                      # Generated migrations
```

## Essential Development Commands

```bash
# Package Management (use ONLY bun - never npm)
bun install                    # Install dependencies
bun --bun run dev             # Start dev server (Vite + instrument.server.mjs)
bun --bun run build           # Production build
bun --bun run start           # Production server
bun --bun run test            # Vitest test runner

# Code Quality (Biome - tab indentation, double quotes)
bun --bun run lint            # Linting
bun --bun run format          # Formatting
bun --bun run check           # Type checking + linting

# Database Operations (drizzle.config.ts)
bun run db:generate           # Generate migrations after schema changes
bun run db:migrate            # Apply pending migrations
bun run db:push               # Push schema changes (dev only)
bun run db:pull               # Pull schema from database
bun run db:studio             # Open Drizzle Studio GUI

# Component Management
pnpx shadcn@latest add [component]  # Add shadcn/ui component
```

## Architecture Patterns

### 1. File-Based Routing
- Routes auto-generated from `src/routes/` files
- **Root layout**: `src/routes/__root.tsx` wraps all routes with `Providers`, theme, toast, and TanStack Devtools
- **oRPC endpoint**: `src/routes/api/rpc.$.ts` handles all RPC calls
- **SSE endpoints**: `src/routes/api/events/*` for real-time updates
- **Regeneration**: `routeTree.gen.ts` auto-regenerates when `bun run dev` is active

### 2. oRPC Procedures (NOT REST)
**CRITICAL: All data fetching uses oRPC, never create REST endpoints**

```typescript
// Define procedure in src/server/orpc/router/*.ts
import { os } from '@orpc/server'
import * as Sentry from '@sentry/react'
import * as z from 'zod'

export const myProcedure = os
  .input(z.object({ field: z.string() }))
  .output(z.object({ result: z.string() }))
  .handler(async ({ input }) => {
    return Sentry.startSpan({ name: 'myProcedure' }, async () => {
      // Implementation
      return { result: 'success' };
    });
  });

// Export from src/server/orpc/router/index.ts
export default {
  myGroup: {
    myProcedure,
  },
};
```

### 3. Database Patterns
**Critical: ALWAYS use quoted identifiers for capitalized table/column names**
```typescript
// Schema definition (src/db/schema.ts)
export const models = pgTable("Models", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  metadata: text("metadata"), // JSON string - cast to JSONB for queries
}, (table) => ({
  nameIdx: index("Models_name_idx").on(table.name),
}));

// Relations
export const modelRelations = relations(models, ({ many }) => ({
  invocations: many(invocations),
}));

// Repository queries (src/server/db/tradingRepository.server.ts)
export const portfolioSnapshotsQuery = (params: { modelName?: string; limit?: number }) =>
  queryOptions({
    queryKey: ['portfolio-snapshots', params.modelName, params.limit ?? 60],
    queryFn: () => repo.fetchPortfolioSnapshots(params),
    staleTime: 30_000, // 30s for volatile data
    gcTime: 5 * 60_000, // 5min cache
  });
```

**Key Database Rules:**
- **netPortfolio** is TEXT representing decimal USD → `CAST("netPortfolio" AS NUMERIC)` for math
- **IDs are TEXT** (not UUID) - compare as strings
- **Timestamps** are TIMESTAMP (no auto timezone conversion)
- **AI-generated SQL is READ-ONLY** - enforce with `enforceReadOnly()` function

### 4. AI Tool Definition
```typescript
// src/server/ai/tools.ts
export const queryPortfolioSql = createTool({
  description: "Generate safe, read-only SQL for portfolio analytics",
  inputSchema: z.object({
    sql: z.string().describe("PostgreSQL query with SELECT/WITH only"),
    reasoning: z.string().describe("Human-readable explanation"),
  }),
  execute: async ({ input }) => {
    try {
      enforceReadOnly(input.sql); // Critical: prevents mutations
      const result = await db.execute(sql.raw(input.sql));
      return { success: true, data: result };
    } catch (error) {
      Sentry.captureException(error);
      return { success: false, error: String(error) };
    }
  },
});
```

**Always extend `SQL_ASSISTANT_PROMPT` (src/server/ai/sqlPrompt.ts) when adding tables**

### 5. Component Patterns
```typescript
// Use cva for variants, cn() for className merging
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("base-classes", {
  variants: { variant: { default: "..." } },
  defaultVariants: { variant: "default" },
});

function Component({ className, ...props }) {
  return <div className={cn("base", className)} {...props} />;
}
```

### 6. Data Fetching with oRPC + TanStack Query
**CRITICAL: Use oRPC queryOptions, NEVER raw fetch or REST endpoints**

```typescript
// Client-side data fetching
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/server/orpc/client'

// Query with prefetching in loader
export const Route = createFileRoute('/my-route')({
  component: MyComponent,
  loader: async ({ context }) => {
    await context.queryClient.prefetchQuery(
      orpc.trading.getTrades.queryOptions({ input: {} })
    );
  },
});

function MyComponent() {
  const { data, isLoading } = useQuery(
    orpc.trading.getTrades.queryOptions({
      input: {},
    })
  );
  
  // For polling, add refetchInterval
  const { data: prices } = useQuery(
    orpc.trading.getCryptoPrices.queryOptions({
      input: { symbols: ['BTC', 'ETH'] },
      refetchInterval: 3000,
      staleTime: 2000,
    })
  );
}

// Mutations
import { useMutation } from '@tanstack/react-query'

const { mutate } = useMutation({
  mutationFn: orpc.simulator.placeOrder.call,
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: orpc.simulator.getAccount.key(),
    });
  },
});

mutate({ symbol: 'BTC', quantity: 1, side: 'buy' });
```

## Environment Configuration

**File**: `src/env.ts` (T3Env - never access `process.env` directly)

**Required Variables:**
- `DATABASE_URL`: PostgreSQL connection string
- `NIM_API_KEY`: NVIDIA NIM for SQL planning
- `ANTHROPIC_API_KEY`: Primary AI provider
- `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`: Fallback providers
- `VITE_SENTRY_DSN`: Client-side error tracking (MUST have `VITE_` prefix)
- `IS_SIMULATION_ENABLED`: Toggle trading mode
- `LIGHTER_API_KEY_INDEX`: Default 2

**Client-side variables** must start with `VITE_`. **Server secrets** must NOT be exposed to client.

## Trading Automation & Simulator

### Trading Modes
- **`env.TRADING_MODE`**: 'live' or 'simulated' (default 'live')
- **Simulator**: `src/server/features/simulator/exchangeSimulator.ts` bootstrapped in `src/server/schedulers/bootstrap.ts`
- **Bootstrap guard**: Ensures schedulers run once per server process

### Key Features
- **TradeExecutor**: ToolLoopAgent in `src/server/features/trading/tradeExecutor.ts`
- **Position Management**: `createPosition`, `closePosition`, `updateExitPlan` tools
- **Auto-close**: Stop-loss/take-profit triggers run by scheduler
- **Market Data**: Refreshes every 3s (simulator fallback if Lighter fails)

### oRPC Procedures
**All data access is via oRPC at `/api/rpc/*`**

**Trading Group** (`orpc.trading.*`):
- `getTrades`: Fetch trade history
- `getPositions`: Fetch open positions with unrealized PnL
- `getCryptoPrices({ symbols })`: Market data (live/simulated)
- `getPortfolioHistory`: Time-series portfolio snapshots

**Models Group** (`orpc.models.*`):
- `getModels`: Fetch AI model configurations
- `getInvocations`: Fetch conversation/invocation history

**AI Chat** (`orpc.chat`):
- `chat({ messages })`: Streaming AI responses with SQL tools

**Simulator Group** (`orpc.simulator.*`):
- `placeOrder({ accountId, symbol, quantity, side, ... })`: Execute simulated trades
- `getAccount({ accountId })`: Fetch account snapshot
- `resetAccount({ accountId })`: Reset simulation state
- `getOrderBook({ symbol })`: Fetch order book snapshot
- `getCompletedTrades({ accountId })`: Fetch simulator trade history
- `getCompletedTradesFromDB({ modelId, limit })`: Fetch DB trade history with stats

**SSE Endpoints** (still REST for streaming):
- `/api/events/trading`: Real-time position updates
- `/api/events/trades`: Real-time trade execution events

## External Integrations

### Lighter API (`lighter-sdk-ts/`)
- **Generated clients**: `CandlestickApi`, `OrderApi`, `MarketApi`
- **Usage**: Always use generated clients inside server features, never raw fetch
- **Alias**: `@/lighter/*` (see tsconfig.json)

### AI Providers
- **OpenRouter**: Multi-model routing
- **Model Config**: `src/core/shared/models/modelConfig.ts`

### Sentry Monitoring
- **Router instrumentation**: `src/router.tsx` (required)
- **Server spans**: Wrap all `createServerFn` handlers with `Sentry.startSpan`
- **No duplication**: Reference `.cursorrules` for Sentry patterns

## Real-time Updates

### Event System (`src/server/features/trading/events`)
- **EventEmitter**: `subscribeToTradingEvents`, `subscribeToTradeEvents`
- **SSE Streaming**: Use existing `emitTradingEvent` helpers
- **WebSocket**: Simulator streaming for order book updates
- **Polling**: Fallback with `usePollingFetch` pattern

## Code Quality & Testing

### Biome Configuration (`biome.json`)
- **Indentation**: Tabs
- **Quotes**: Double quotes
- **Line width**: 80 characters

### Testing Strategy
- **Unit tests**: Vitest for server functions and utilities
- **Component tests**: React Testing Library for UI components
- **Mocking**: Always mock Lighter API and Claude in tests
- **Coverage**: Test both live and simulated trading paths
- **Type safety**: TypeScript strict mode compliance mandatory

### Security Requirements
- **Never commit API keys**: Use `.env.local` (gitignored)
- **Validate all inputs**: Zod schemas for every API endpoint
- **SQL sanitization**: Use Drizzle ORM - NO raw queries
- **Rate limiting**: Implement for public endpoints
- **Authentication**: Required for all trading APIs

## Common Pitfalls to Avoid

1. **Package manager**: Use ONLY `bun` - never `npm` or `pnpm`
2. **Environment variables**: Never use `process.env` directly - use `src/env.ts`
3. **oRPC procedures**: Always wrap handlers with Sentry.startSpan, use .input() and .output() schemas
4. **Database keys**: Always quote capitalized identifiers: `"Models"`, `"netPortfolio"`
5. **AI SQL**: ALWAYS enforce read-only with `enforceReadOnly()` function
6. **Client imports**: Keep Node-only modules out of client bundles
7. **Trading parameters**: Never hardcode - use environment variables
8. **NO REST**: Never create `/api/*` endpoints - use oRPC procedures instead
9. **Polyfills**: Always `import '@/polyfill'` first in oRPC procedure files
10. **Data fetching**: Use `orpc.*.*.queryOptions()` with TanStack Query, never raw fetch

## Performance Guidelines

- **Query caching**: 15s-5min based on data volatility
- **Database indexing**: All foreign keys and common WHERE clauses
- **Lazy loading**: Heavy components (charts, simulators)
- **React 19 compiler**: Enable optimizations where possible
- **Streaming**: Use for large datasets and AI responses

## Documentation References

- **Trading agent notes**: `docs/trading-agent-notes.md` (guardrails)
- **Schema documentation**: Extend `SQL_ASSISTANT_PROMPT` when adding tables
- **Component recipes**: `src/components/ai-elements/` has 30+ specialized components
