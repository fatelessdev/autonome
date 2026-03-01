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
  - run all model trades
  - record portfolio snapshots
  - retention/downsampling steps
  - sleep 5 minutes

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
- Workflow steps: `src/server/workflows/steps`
- Market metadata: `src/core/shared/markets/marketMetadata.ts`
- Shared trading calculations: `src/core/shared/trading/calculations.ts`
- Shared SSE client util: `src/core/lib/sseConnection.ts`

---

## 8) Definition of Done (for agent PRs)

A change is complete when:
- behavior is correct end-to-end,
- impacted layers are aligned (server/client/types/docs),
- quality checks pass (or unrelated failures are clearly called out),
- docs/instructions are updated if architecture/contracts changed.
