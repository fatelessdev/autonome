# Cross-Area Flow Validation Contracts

These assertions validate behaviors that span multiple architectural areas: the
trade cycle workflow, reconciliation, analytics, prompt construction, market
intelligence caching, and performance infrastructure.

---

## VAL-CROSS-001 — End-to-end trade cycle produces complete state

**Title:** Full trade cycle writes orders, snapshots, invocations, and reconciles
orphans correctly.

### Behavioral Description

After `executeAllModelTrades()` and `portfolioSnapshotStep()` complete within
`tradeCycleWorkflow`, the database must contain:

| Sub-assertion | Pass condition | Fail condition |
|---|---|---|
| **(a) Closed-position P&L** | Every order row with `status = 'CLOSED'` has a non-null `realizedPnl` that is a finite number. Orders closed by reconciliation (`closeTrigger = 'RECONCILE'`) must have `realizedPnl = '0'` (not null, not missing). | Any closed order has `realizedPnl = null` or is non-numeric. |
| **(b) Portfolio snapshots** | After `portfolioSnapshotStep`, the `PortfolioSize` table has a new row for each valid model with `netPortfolio > 0` (assuming non-zero account). | No snapshot row written for any valid model, or `netPortfolio` is null/NaN. |
| **(c) Decision diary entries** | Each model's `Invocations` row (created by `createInvocationMutation`) has a `responsePayload` JSONB that contains: `prompt` (non-empty string), `decisions` (array), `executionResults` (array). | `responsePayload` is null, or missing `prompt`/`decisions`/`executionResults` keys, or `prompt` is empty. |
| **(d) Failure rate** | For any model with `invocationCount > 0`, the computed failure rate (`failedWorkflowCount / invocationCount`) is strictly less than 100%. A 100% failure rate indicates the kill-switch or all-attempts-exhausted path, which should be a known alert, not normal operation. | Any model shows 100% failure rate across its lifetime (non-zero invocations, all failed). |

### Tool

Automated test: mock Alpaca API, DB, and LLM provider. Run
`executeAllModelTrades()` → `recordPortfolios()`. Query DB rows and assert
invariants.

### Evidence Requirements

- DB query: `SELECT id, status, "realizedPnl", "closeTrigger" FROM "Orders" WHERE status = 'CLOSED'`
- DB query: `SELECT modelId, "netPortfolio", "createdAt" FROM "PortfolioSize" ORDER BY "createdAt" DESC LIMIT 10`
- DB query: `SELECT id, "modelId", "responsePayload"->>'prompt' AS prompt_len, jsonb_array_length("responsePayload"->'decisions') AS decision_count FROM "Invocations" ORDER BY "createdAt" DESC LIMIT 10`
- DB query: `SELECT id, name, "invocationCount", "failedWorkflowCount" FROM "Models" WHERE "invocationCount" > 0`
- Code evidence: `reconciliation.ts` — `closeOrder({ realizedPnl: "0" })` — verify "0" string, not null.

---

## VAL-CROSS-002 — Analytics metrics flow into the AI prompt

**Title:** The `PERFORMANCE_OVERVIEW` prompt section contains Welford Sharpe,
trade-based Sharpe, win rate, drawdown, and recovery factor computed from live
DB data.

### Behavioral Description

When `buildTradingPrompts()` is called during `runTradeWorkflow()`, the
`PerformanceMetrics` object must include:

| Field | Source | Pass condition | Fail condition |
|---|---|---|---|
| `welfordSharpeRatio` | `getSharpeRatio(account.id)` via Welford service | Non-empty string. Either a decimal (e.g. `"1.234"`) or `"N/A"` with a reason. | Empty string, `undefined`, or hardcoded value. |
| `sharpeRatio` | `calculateSharpeRatioFromTrades()` on closed order P&Ls | Finite number string or `"N/A (need more trades)"`. | Computed from portfolio returns instead of per-trade P&Ls. |
| `winRate` | `calculateWinRate(pnls)` from closed orders | Percentage string like `"65.0%"` or `"N/A"`. | Missing or always 0% despite closed winning trades. |
| `currentDrawdown` | Alpaca portfolio history | Percentage string. | `"N/A"` when Alpaca history has ≥2 data points. |
| `recoveryFactor` | `calculateRecoveryFactor()` from portfolio history | Numeric string or `"N/A"`. | Always `"N/A"` when drawdown is available. |

The rendered `PERFORMANCE_OVERVIEW` section in the user prompt must contain the
literal substrings `welford_sharpe_ratio:` and `annualized_sharpe_ratio:` (from
`buildPerformanceOverview()` in `promptSections.ts`).

### Tool

Unit test: mock `getClosedOrdersByModel` to return 10+ closed orders with known
P&Ls. Mock `getSharpeRatio` to return a valid result. Call
`calculatePerformanceMetrics()` and assert all fields are non-empty and
correctly formatted. Then call `buildTradingPrompts()` and assert the rendered
prompt contains the expected substrings.

### Evidence Requirements

- Code: `performanceMetrics.ts` — `calculatePerformanceMetrics()` reads from
  `getClosedOrdersByModel()` (single query) and `getSharpeRatio()`.
- Code: `promptSections.ts` — `buildPerformanceOverview()` renders
  `welford_sharpe_ratio:` and `annualized_sharpe_ratio:` from
  `PerformanceMetrics`.
- Test output: rendered `PERFORMANCE_OVERVIEW` string.

---

## VAL-CROSS-003 — Invocation diary entries are retrievable via analytics

**Title:** Decision data stored per invocation is queryable, filterable by
variant/symbol/date, and links to market state.

### Behavioral Description

Each trade cycle invocation writes an `Invocations` row with
`responsePayload` containing structured decision data. The analytics oRPC
router (`src/server/orpc/router/analytics.ts`) and the failures query
(`failureQueries.ts`) must be able to:

| Sub-assertion | Pass condition | Fail condition |
|---|---|---|
| **(a) Retrievability** | `getRecentFailures()` returns entries where each `FailureEntry` has a `responsePayload` that deserializes to an object containing `decisions`, `executionResults`, `closedPositions`, and `stepTelemetry`. | Payload is null or missing these keys for successful invocations that are also queryable. |
| **(b) Variant filtering** | `getModelFailureStats(variantFilter)` returns stats only for models matching the variant. | Results include models from other variants. |
| **(c) Date ordering** | `getRecentFailures()` returns entries ordered by `createdAt DESC`. | Entries are unordered or in ascending order. |
| **(d) Market state linkage** | Each `Invocation.responsePayload.prompt` contains the `MARKET_INTELLIGENCE` text that was injected at invocation time (includes symbol data, technical indicators). If TAAPI was configured, the prompt also contains `Supplementary Indicators`. | Prompt field is empty or missing market data that was available at invocation time. |

### Tool

Integration test: seed DB with invocations across 3 variants. Query with each
variant filter. Assert count and ordering. Deserialize payload and assert keys.

### Evidence Requirements

- DB query: `SELECT "responsePayload" FROM "Invocations" ORDER BY "createdAt" DESC LIMIT 5`
- Code: `failureQueries.ts` — `getRecentFailures()` deserializes
  `responsePayload` and extracts `stepTelemetry`.
- Code: `tradeWorkflow.ts` — `buildInvocationResponsePayload()` includes
  `prompt`, `decisions`, `executionResults`, `closedPositions`.
- Code: `invocationResponse.ts` — `InvocationResponsePayload` interface defines
  all expected fields.

---

## VAL-CROSS-004 — TAAPI key rotation and market intelligence cache coherence

**Title:** TAAPI requests use key rotation when multiple keys are configured,
and the market intelligence cache returns consistent data across all models in
a cycle.

### Behavioral Description

| Sub-assertion | Pass condition | Fail condition |
|---|---|---|
| **(a) Key rotation** | When multiple `TAAPI_API_KEY` values are configured (comma-separated), the `TaapiClient` cycles through them on successive bulk requests. Each `POST` to `https://api.taapi.io/bulk` uses a different `secret` field until all keys are exhausted, then wraps around. | All requests use the same key, or key selection is random rather than round-robin. |
| **(b) Shared cache** | `getSharedMarketIntelligence()` returns identical `snapshots` and `formatted` strings when called multiple times within the cache TTL window (2 minutes). Only one HTTP fetch occurs; subsequent calls return the cached entry. | Each call triggers a new HTTP fetch, or different models in the same cycle receive different market data. |
| **(c) Cache invalidation** | After `invalidateMarketIntelligenceCache()` is called (at the end of `executeAllModelTrades`), the next call to `getSharedMarketIntelligence()` fetches fresh data (cache miss). | Stale data is returned after invalidation. |
| **(d) Graceful degradation** | If TAAPI is not configured (`TAAPI_API_KEY` is empty), `getSharedMarketIntelligence()` still returns valid market snapshots without TAAPI supplementary data. The formatted string does not contain `Supplementary Indicators` sections. | Missing TAAPI key causes an exception or returns empty market data. |

### Tool

Unit test: mock `fetch` for TAAPI bulk endpoint. Verify different `secret`
values across calls. Mock Alpaca market data. Call
`getSharedMarketIntelligence()` twice rapidly; assert single fetch. Call
`invalidateMarketIntelligenceCache()`, then call again; assert second fetch.

### Evidence Requirements

- Code: `taapi/client.ts` — `TaapiClient` reads `TAAPI_API_KEY` from env
  (single key currently). Key rotation requires env parsing of comma-separated
  keys or a key-provider wrapper.
- Code: `marketIntelligenceCache.ts` — `getSharedMarketIntelligence()` uses
  `globalThis.__marketIntelligenceCache` with TTL check and in-flight promise
  deduplication.
- Code: `tradeWorkflow.ts` — `executeAllModelTrades()` calls
  `invalidateMarketIntelligenceCache()` after all models complete.
- Note: Current implementation uses a single `TAAPI_API_KEY` from env. Key
  rotation requires multi-key support. If not yet implemented, this assertion
  documents the expected contract for when it is.

---

## VAL-CROSS-005 — Performance optimization reduces redundant queries

**Title:** After caching and hoisting optimizations, `getAllOpenOrders` is
called once per cycle (not per-model), and `rebuildUserPrompt` uses cached
data instead of 4 fresh queries per step.

### Behavioral Description

| Sub-assertion | Pass condition | Fail condition |
|---|---|---|
| **(a) Hoisted `getAllOpenOrders`** | In `executeAllModelTrades()`, `getAllOpenOrders()` is called once after all models complete, and the result is passed as `preloadedOrders` to `reconcilePositions()`. Within `runTradeWorkflow()`, `getAllOpenOrders()` is called once in the initial parallel fetch (`Promise.all`). Total: 1 call in the workflow + 1 call for reconciliation = 2 per cycle, not 3–5. | `getAllOpenOrders()` is called inside `reconcilePositions()` without `preloadedOrders`, or called separately per model in the reconciliation loop. |
| **(b) `rebuildUserPrompt` data reuse** | `rebuildUserPrompt()` in `tradeWorkflow.ts` fetches `portfolio`, `openPositions`, `decisionIndex`, and `allOpenOrders` via `Promise.all` — these 4 queries run in parallel. The `performanceMetrics`, `marketIntelligence`, `newsDigest`, and `competition` values are reused from the outer scope (not re-fetched). | `rebuildUserPrompt()` re-fetches market intelligence, news, performance metrics, or competition data. |
| **(c) Reconciliation uses preloaded orders** | `reconcilePositions(account, allOpenOrders)` receives the pre-fetched orders array. The function skips the `getAllOpenOrders()` DB call when `preloadedOrders` is provided. | `reconcilePositions()` ignores `preloadedOrders` and always queries the DB. |
| **(d) Cycle parallelism** | Models run in parallel via `Promise.all(validModels.map(runModel))`. Reconciliation also runs in parallel across models via `Promise.all(validModels.map(...))`. | Models run sequentially. |

### Tool

Code review + instrumentation test: spy on `getAllOpenOrders` call count during
a full `executeAllModelTrades()` run. Spy on `portfolioQuery`,
`openPositionsQuery`, `getSharedMarketIntelligence` calls during
`rebuildUserPrompt()`.

### Evidence Requirements

- Code: `tradeWorkflow.ts` — `const allOpenOrders = await getAllOpenOrders();`
  in `executeAllModelTrades()` — single call before reconciliation loop.
- Code: `tradeWorkflow.ts` — `await reconcilePositions(account, allOpenOrders)` —
  preloaded orders passed.
- Code: `reconciliation.ts` — `preloadedOrders ?? (await getAllOpenOrders())` —
  conditional DB call.
- Code: `tradeWorkflow.ts` — `rebuildUserPrompt()` closure captures
  `performanceMetrics`, `marketIntelligence`, `newsDigest`, `competition` from
  outer scope.
- Test: spy assertion showing `getAllOpenOrders` call count = 2 per cycle
  (1 in runTradeWorkflow + 1 in executeAllModelTrades for reconciliation).

---

## VAL-CROSS-006 — Quality gates pass and docs match reality

**Title:** `tsc --noEmit`, `bun run check`, and `bun run test` all pass;
`AGENTS.md` accurately describes the as-built codebase.

### Behavioral Description

| Sub-assertion | Pass condition | Fail condition |
|---|---|---|
| **(a) Type safety** | `bunx tsc --noEmit` exits with code 0. No type errors in any file under `src/` or `api/src/`. | Any TypeScript error. |
| **(b) Lint/format** | `bun run check` (Biome) exits with code 0. No lint violations. | Any Biome error or warning that blocks the check. |
| **(c) Unit tests** | `bun run test` exits with code 0. All test suites pass. | Any test failure. |
| **(d) Doc accuracy** | `AGENTS.md` Section 2 ("Current Architecture") correctly describes: (1) the `tradeCycleWorkflow` steps (trades → snapshots → retention), (2) reconciliation running after trades in `executeAllModelTrades`, (3) Welford Sharpe in `welfordService.ts`, (4) error deduplication in `errorDeduplicator.ts`, (5) correlation matrix in `correlationMatrix.ts`, (6) market intelligence cache TTL in `marketIntelligenceCache.ts`. | Any documented behavior diverges from actual code (e.g., AGENTS.md says reconciliation runs as a separate step but code shows it's inline in `executeAllModelTrades`). |
| **(e) Key files exist** | Every file listed in AGENTS.md Section 7 ("Key Files") exists at the documented path. | Any listed file is missing or renamed. |

### Tool

CI pipeline: run `bunx tsc --noEmit && bun run check && bun run test`. Doc
audit: grep AGENTS.md key file paths and verify each exists on disk.

### Evidence Requirements

- CI log: TypeScript, Biome, and test runner output.
- Script: `for path in $(grep -oP '`[^`]+`' AGENTS.md | grep '\.ts'); do [ -f "src/$path" ] || echo "MISSING: $path"; done`
- Manual review: compare AGENTS.md Section 2 prose against `tradeCycle.ts`,
  `tradeWorkflow.ts`, `reconciliation.ts`, `welfordService.ts`.

---

## Cross-Area Dependency Graph

```
VAL-CROSS-001 (trade cycle correctness)
  ├── depends on: reconciliation fix (realizedPnl for orphaned orders)
  ├── depends on: portfolio snapshot writes
  └── depends on: invocation payload structure

VAL-CROSS-002 (analytics → prompt)
  ├── depends on: VAL-CROSS-001 (accurate DB data)
  ├── depends on: Welford service cold-start bootstrap
  └── depends on: performanceMetrics query correctness

VAL-CROSS-003 (diary → analytics page)
  ├── depends on: VAL-CROSS-001(c) (invocation payloads)
  └── depends on: oRPC analytics router

VAL-CROSS-004 (TAAPI rotation → market cache)
  ├── depends on: shared market intelligence cache
  └── depends on: TAAPI key configuration

VAL-CROSS-005 (performance optimization)
  ├── depends on: getAllOpenOrders hoisting
  ├── depends on: reconciliation preloadedOrders parameter
  └── depends on: rebuildUserPrompt scope capture

VAL-CROSS-006 (quality gates)
  └── depends on: all other assertions being implementable
```

## Known Issues Documented

1. **Reconciled orders have `realizedPnl = "0"`** — This is correct behavior
   for orphaned orders (Alpaca closed the position, we don't know the actual
   P&L). However, `performanceMetrics.ts` sums all closed order P&Ls, so
   reconciled orders contribute 0 to the total. This is acceptable but should
   be documented.

2. **`rebuildUserPrompt` still makes 4 DB/API calls** — These are parallel via
   `Promise.all`, so wall-clock time is dominated by the slowest call. The
   optimization is that `performanceMetrics`, `marketIntelligence`, `newsDigest`,
   and `competition` are NOT re-fetched.

3. **TAAPI key rotation** — Current code uses a single `TAAPI_API_KEY` env var.
   The assertion documents the expected contract for multi-key rotation if/when
   implemented.
