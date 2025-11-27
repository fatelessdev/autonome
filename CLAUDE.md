# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonome is an AI-powered autonomous cryptocurrency trading platform built with TanStack Start, featuring real-time portfolio analytics, multi-model AI integration, and a sophisticated trading simulator with both live and simulated trading modes.

## Essential Development Commands

```bash
# Package Management (CRITICAL: Use ONLY bun - never npm or pnpm)
bun install                    # Install dependencies
bun --bun run dev             # Start dev server (Vite + instrument.server.mjs)
bun --bun run build           # Production build
bun --bun run start           # Production server
bun --bun run test            # Vitest test runner

# Code Quality (Biome - tab indentation, double quotes, 80 char width)
bun --bun run lint            # Linting
bun --bun run format          # Formatting
bun --bun run check           # Type checking + linting

# Database Operations (Drizzle ORM)
bun run db:generate           # Generate migrations after schema changes
bun run db:migrate            # Apply pending migrations
bun run db:push               # Push schema changes (dev only)
bun run db:studio             # Open Drizzle Studio GUI

# Component Management
pnpx shadcn@latest add [component]  # Add shadcn/ui component
```

## Architecture Overview

### Technology Stack
- **Framework**: TanStack Start with React 19, TypeScript (strict mode), file-based routing
- **Data**: PostgreSQL with Drizzle ORM, TanStack Query with oRPC, aggressive caching (15s-5min)
- **AI**: AI SDK v6 with multi-provider support (Anthropic Claude primary, Google/OpenAI/Mistral/NVIDIA NIM fallbacks)
- **Trading**: Lighter REST API integration with auto-generated TypeScript SDK
- **Real-time**: Server-Sent Events (SSE), WebSocket fallback, EventEmitter publishers
- **Build**: Vite with SSR support, TanStack Router plugin
- **Styling**: Tailwind CSS v4, shadcn/ui components, Lucide icons

### Critical Architecture Patterns

1. **NO REST Endpoints**: All data fetching uses oRPC procedures, never create REST endpoints
2. **File-Based Routing**: Routes auto-generated from `src/routes/` files
3. **Database Rules**: ALWAYS quote capitalized identifiers (`"Models"`, `"netPortfolio"`)
4. **Environment Variables**: Never use `process.env` directly - use `src/env.ts` (T3Env)
5. **AI SQL Safety**: ALWAYS enforce read-only with `enforceReadOnly()` function

### Key Directory Structure

```
src/
├── routes/                     # File-based routing (TanStack Router)
│   ├── __root.tsx             # Root layout with Providers, theme, toast
│   ├── api/rpc.$.ts           # Main oRPC endpoint (CRITICAL: all data access)
│   └── api/events/            # SSE endpoints for real-time updates
├── server/                    # Server-side code
│   ├── features/              # Domain logic (trading, simulator, integrations)
│   ├── orpc/                  # Type-safe RPC endpoints (router.ts, client.ts)
│   ├── db/                    # Repository pattern with query definitions
│   └── ai/                    # AI tools, prompts, SQL assistant
├── components/                # UI components
│   ├── ui/                    # shadcn/ui primitives
│   └── ai-elements/           # AI SDK components
├── db/                        # Database schema and connection
└── env.ts                     # T3Env configuration
```

## Development Guidelines

### Data Fetching Pattern
```typescript
// Use oRPC queryOptions with TanStack Query - NEVER raw fetch
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/server/orpc/client'

const { data } = useQuery(
  orpc.trading.getTrades.queryOptions({ input: {} })
)
```

### Database Schema Rules
```typescript
// ALWAYS quote capitalized identifiers
export const models = pgTable("Models", {
  id: text("id").primaryKey(),
  netPortfolio: text("netPortfolio"), // TEXT representing decimal USD
})
```

### oRPC Procedure Creation
```typescript
// All procedures go in src/server/orpc/router/*.ts
// Export from src/server/orpc/router/index.ts
// NEVER create /api/* endpoints
```

### Environment Configuration
Required variables in `src/env.ts`:
- `DATABASE_URL`: PostgreSQL connection string
- `ANTHROPIC_API_KEY`: Primary AI provider
- `NIM_API_KEY`: NVIDIA NIM for SQL planning
- `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`: Fallback providers
- `VITE_SENTRY_DSN`: Client-side error tracking (MUST have `VITE_` prefix)

## Trading System Architecture

### Trading Modes
- `TRADING_MODE`: 'live' or 'simulated'
- `IS_SIMULATION_ENABLED`: Toggle trading mode
- Simulator: `src/server/features/simulator/exchangeSimulator.ts`

### Position Persistence Architecture
Positions are persisted to the database for durability across server restarts:

- **Schema**: `positions` table in `src/db/schema.ts` with modelId, symbol, side, quantity, entryPrice, exitPlan (JSONB)
- **Repository**: `src/server/db/positionsRepository.ts` - CRUD operations for positions
- **Create Flow**: `createPosition.ts` → execute order → `upsertPosition()` to DB
- **Close Flow**: `closePosition.ts` → execute order → `closePositionRecords()` from DB
- **Fetch Flow**: `queries.server.ts` → `fetchPositions()` reads from DB with live prices

### Workflow Events (SSE)
Unified event system for real-time updates:

- **Event System**: `src/server/events/workflowEvents.ts` - Single emitter for all data changes
- **SSE Endpoint**: `/api/events/workflow` - One connection for all notifications
- **Event Flow**: Workflow completes → `emitAllDataChanged(modelId)` → clients refetch via oRPC
- **Event Types**: `workflow:complete`, `batch:complete`, `positions:changed`, `trades:changed`, `conversations:changed`

### Key oRPC Procedures
- **Trading**: `orpc.trading.*` (getTrades, getPositions, getCryptoPrices, getPortfolioHistory)
- **Simulator**: `orpc.simulator.*` (placeOrder, getAccount, getOrderBook, getCompletedTrades)
- **Models**: `orpc.models.*` (getModels, getInvocations)
- **AI Chat**: `orpc.chat` (streaming AI with SQL tools)

### Real-time Updates
- SSE endpoint: `/api/events/workflow` (unified for all data types)
- Legacy SSE: `/api/events/trading`, `/api/events/trades`, `/api/events/positions` (deprecated)
- EventEmitter pattern with `subscribeToWorkflowEvents()`
- Clients receive events → invalidate TanStack Query caches → refetch via oRPC

## Testing Strategy

- **Framework**: Vitest with React Testing Library
- **Mocking**: Always mock Lighter API and Claude in tests
- **Coverage**: Test both live and simulated trading paths
- **Type safety**: TypeScript strict mode compliance mandatory

## Common Pitfalls to Avoid

1. **Package manager**: Use ONLY `bun` - never `npm` or `pnpm`
2. **Environment variables**: Never use `process.env` directly
3. **Database identifiers**: Always quote capitalized table/column names
4. **AI SQL**: ALWAYS enforce read-only with `enforceReadOnly()`
5. **NO REST endpoints**: Use oRPC procedures instead
6. **Data fetching**: Use `orpc.*.*.queryOptions()` with TanStack Query
7. **Client bundles**: Keep Node-only modules out of client code
8. **Polyfills**: Always `import '@/polyfill'` first in oRPC procedure files