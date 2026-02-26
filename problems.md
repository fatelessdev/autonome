# Known Issues & Technical Debt

**Last updated:** 2026-02-26

This document tracks active issues and remaining architectural debt in the Autonome codebase.

---

## High Issues

### 1. Bracket Close Sync Is Missing (HIGH)
**File:** `src/server/features/trading/openPositions.ts`, `ordersRepository.server.ts`
**Severity:** High
**Description:** Fetch-time DB auto-reconciliation is intentionally disabled. When an Alpaca bracket SL/TP closes a position, broker state is correct immediately, but DB order metadata can remain OPEN until an explicit lifecycle sync runs.
**Impact:** UI/prompt open positions are now correct (live-first), but DB audit/history metadata can drift and later analytics based only on DB status can lag.
**Fix needed:** Add explicit sync via webhook or scheduled workflow step to close orphaned OPEN orders with precise `closeTrigger` (`bracket_sl` / `bracket_tp`). Do not reintroduce read-path mutation.

---

## SSOT Violations (Single Source of Truth)

### 3. Hardcoded `COIN_STYLES` in crypto-tracker (MEDIUM)
**File:** `src/components/crypto-tracker.tsx` ~L26
**SSOT:** `src/core/shared/markets/marketMetadata.ts`
**Description:** `COIN_STYLES` object hardcodes coin badges, logo paths, and decimal precision for each symbol. Adding/removing a market requires updating this file separately.
**Fix needed:** Move `logo`, `decimals`, and `badge` into `marketMetadata.ts` and derive `COIN_STYLES` from it.

### 4. Coin Metadata (logo, decimals) Not in SSOT (MEDIUM)
**Files:** `src/components/crypto-tracker.tsx`, `src/components/trades-sidebar/positions-tab.tsx`
**SSOT:** `src/core/shared/markets/marketMetadata.ts`
**Description:** Two separate files define icon/logo/decimal mappings for coins. The `MARKETS` SSOT only stores `symbol`, `canonical`, and `assetClass` — it should also include `logo`, `decimals`, and `badge` metadata so all UI components derive from one source.
**Fix needed:** Extend `MARKETS` entries in `marketMetadata.ts` with `logo: string`, `decimals: number` properties. Derive UI maps from this SSOT.

### 5. Stale "Guardian" References in Comments/Docs (LOW)
**Files & lines:**
- `src/core/shared/variants/index.ts` L178-179 — JSDoc example uses `"Guardian"`
- `src/core/utils/excelExport.ts` L238 — Comment lists "Guardian" as a variant
- `src/core/shared/cache/cacheConfig.ts` L74-75 — JSDoc example uses `{ variant: "Guardian" }`
- `src/server/features/analytics/queries.server.ts` L293 — JSDoc uses `"Guardian"` as example
- `src/server/features/trading/prompts/old/prompt3.ts` L12 — "GUARDIAN / MONK MODE"
**Description:** "Guardian" is a retired variant name. These stale references in comments/docs could confuse future developers.
**Fix needed:** Update all JSDoc/comments to use current variant names (Apex, Trendsurfer, Contrarian, Sovereign).

### 6. Stale Excel Export Comment (LOW)
**File:** `src/core/utils/excelExport.ts` L234-241
**Description:** Comment lists old variant names ("Situational", "Minimal", "Guardian", "Max") that don't exist. Code correctly uses `VARIANT_IDS` for iteration — only the comment is wrong.
**Fix needed:** Update the JSDoc to reflect current variant names.

---

## Duplicated Code

### 8. Duplicate `formatPercent` Function (4 copies) (MEDIUM)
| File | Line | Implementation |
|------|------|----------------|
| `src/routes/analytics.tsx` | 52 | `(value, decimals=2) => \`${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%\`` |
| `src/routes/leaderboard.tsx` | 46 | `(value) => \`${value.toFixed(2)}%\`` |
| `src/routes/failures.tsx` | 51 | `(value) => \`${value.toFixed(2)}%\`` |
| `src/server/features/trading/promptSections.ts` | 42 | `function formatPercent(value, decimals)` |
**Impact:** Inconsistent behavior (analytics.tsx adds `+` prefix, others don't). Bug fixes must be applied in 4 places.
**Fix needed:** Create a single `formatPercent` in `src/core/shared/formatting/numberFormat.ts` and import everywhere.

### 9. Event System Boilerplate (5 copies) (MEDIUM)
**Files:**
- `src/server/events/workflowEvents.ts`
- `src/server/features/trading/events/tradeEvents.ts`
- `src/server/features/trading/events/positionEvents.ts`
- `src/server/features/trading/events/conversationEvents.ts`
- `src/server/features/portfolio/events/portfolioEvents.ts`
**Description:** Each file repeats the same pattern:
```typescript
const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const EVENT_KEY = "...";
export const emitXEvent = (event) => { emitter.emit(EVENT_KEY, event); };
export const subscribeToXEvents = (listener) => { ... return unsubscribe; };
```
**Fix needed:** Create a shared `createTypedEventBus<T>()` factory to eliminate boilerplate.

### 10. Scattered `staleTime`/`gcTime` Cache Values (LOW)
**Files:** `queries.server.ts`, `openPositions.server.ts`, `marketData.server.ts`, `getPortfolio.server.ts`, `priceTracker.ts`
**SSOT:** `src/core/shared/cache/cacheConfig.ts` (exists but underutilized)
**Description:** Multiple server-side query options define cache timing as magic numbers (15_000, 60_000, 20_000, 30_000, 10_000) rather than importing from `CACHE_TIMING` config.
**Fix needed:** Centralize all cache timing constants in `cacheConfig.ts` and import across all query files.

### 11. Duplicated 5-minute Trade Cycle Interval (LOW)
| File | Line | Value |
|------|------|-------|
| `src/server/workflows/tradeCycle.ts` | 25 | `TRADE_CYCLE_INTERVAL_MS = 5 * 60 * 1000` |
| `src/core/shared/trading/dashboardQueries.ts` | 16 | `BASE_REFRESH_MS = 5 * 60 * 1000` |
**Fix needed:** Extract to a shared constant in `@/core/shared/trading/calculations.ts` or a new `constants.ts`.

---

## Other Issues

### 12. Leverage Ghost References in UI/Analytics (~19 files) (LOW)
**Files:** `competitionSnapshot.ts`, `queries.server.ts`, `tradingDecisions.ts`, `consensusOrchestrator.ts`, `analytics/calculations.ts`, `analytics/types.ts`, `analytics/queries.server.ts`, `positionsRepository.ts`, `dashboardQueries.ts`, `dashboardTypes.ts`, `trades-sidebar/utils.ts`, `positions-tab.tsx`, `model-chat-tab.tsx`, `excelExport.ts`, `numberFormat.ts`, `orpc/router/trading.ts`, `orpc/router/analytics.ts`, `orpc/schema.ts`, `analytics.tsx`
**Description:** ~19 files still reference `leverage` in non-breaking ways — reading from the DB column (null for new orders). UI shows "1.0x" for new positions.
**Fix needed:** Remove leverage display from all UI components, analytics calculations, and export utilities.

### 13. ConsensusOrchestrator Dead Leverage Code (LOW)
**File:** `src/server/features/trading/consensusOrchestrator.ts`
**Description:** Internal consensus types still have `leverage` fields. The median-leverage calculation produces no useful output for spot trading. The consensus prompt still says "Use leverage 1-5x".
**Fix needed:** Remove `leverage` from types, calculations, and prompt text.

### 15. WORKFLOW_POSTGRES_URL Not Wired (LOW)
**File:** `src/env.ts`
**Description:** `WORKFLOW_POSTGRES_URL` is defined in env validation but not connected to any runtime code. The Workflow DevKit world likely needs this for durable state persistence.
**Fix needed:** Wire `WORKFLOW_POSTGRES_URL` to the workflow world configuration (via `WORKFLOW_TARGET_WORLD` env var or equivalent).

---

## Priority Matrix

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| #1 Bracket trigger reconciliation | High | 4 hours | P1 |
| #3 COIN_STYLES not from SSOT | Medium | 1 hour | P2 |
| #4 Coin metadata not in SSOT | Medium | 1 hour | P2 |
| #8 Duplicate formatPercent | Medium | 30 min | P2 |
| #9 Event system boilerplate | Medium | 2 hours | P2 |
| #5 Stale Guardian refs | Low | 15 min | P3 |
| #6 Stale Excel comment | Low | 5 min | P3 |
| #10 Scattered cache timing | Low | 1 hour | P3 |
| #11 Duplicated interval const | Low | 10 min | P3 |
| #12 Leverage ghost refs | Low | 3 hours | P3 |
| #13 Consensus dead leverage | Low | 1 hour | P3 |
| #15 WORKFLOW_POSTGRES_URL | Low | 15 min | P3 |


**Estimated total to fix remaining:** ~16 hours

---

*Related documentation: See `AGENTS.md` for architecture overview.*
