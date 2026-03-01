# Known Issues & Technical Debt

**Last updated:** 2026-02-28

This file lists issues that are currently reproducible in the codebase. Stale paths and already-resolved items were removed during this refresh.

---

## High Issues

### 1. Bracket-Close DB Reconciliation Still Missing (HIGH)
**Files:** `src/server/features/trading/data/positions.ts`, `src/server/db/ordersRepository.server.ts`
**Severity:** High
**Description:** Open positions are sourced live from Alpaca (correct for UI/agent), but DB `"Orders"` status is not explicitly reconciled when Alpaca closes positions via bracket SL/TP. This can leave DB rows OPEN after broker closure.
**Impact:** History/audit/analytics paths that rely on DB lifecycle fields can drift from broker truth.
**Fix needed:** Add an explicit lifecycle sync (webhook or scheduled step) that closes orphaned OPEN orders and writes accurate `closeTrigger` (for example `bracket_sl` / `bracket_tp`). Keep read paths mutation-free.

---

## Duplicated Code

### 5. Cache Timing Constants Are Still Scattered (LOW)
**Files:** `src/server/db/tradingRepository.server.ts`, `src/server/features/trading/data/positions.server.ts`, `src/server/features/trading/data/tradingQueries.server.ts`
**SSOT target:** `src/core/shared/cache/cacheConfig.ts`
**Description:** `CACHE_TIMING` exists, but many query definitions still hardcode timing numbers (`15_000`, `30_000`, `60_000`, `2 * 60_000`, etc.).
**Fix needed:** Replace ad-hoc timing values with imports from `CACHE_TIMING` where semantics match.

### 6. 5-Minute Interval Constant Is Repeated (LOW)
**Files:** `src/server/workflows/tradeCycle.ts`, `src/core/shared/trading/dashboardQueries.ts`, `src/server/integrations/alpaca-news/client.ts`
**Description:** The same `5 * 60 * 1000` interval appears in multiple modules with different local names.
**Fix needed:** Extract a shared constant for the canonical trade-cycle cadence and reuse it.

---

## Trading Semantics

### 7. Leverage Fields Still Drive Spot-Flow Surfaces (LOW)
**Files:** `src/server/features/trading/execution/consensusOrchestrator.ts`, `src/db/schema.ts`, `src/core/utils/excelExport.ts`, `src/components/trades-sidebar/model-chat-tab.tsx`, `src/core/shared/trading/dashboardQueries.ts`
**Description:** The codebase still carries leverage values/prompts (including consensus instructions like "Use leverage 1-5x") despite spot-oriented execution behavior.
**Fix needed:** Decide if leverage remains a first-class concept. If not, remove leverage from prompt/schema/UI/analytics paths consistently.

### 8. `WORKFLOW_POSTGRES_URL` Is Declared But Not Consumed In Runtime Code (LOW)
**Files:** `src/env.ts`, `src/server/workflows/tradeCycle.ts`
**Description:** Env validation includes `WORKFLOW_POSTGRES_URL`, but no application code wires it into workflow world configuration.
**Fix needed:** Either wire it to workflow runtime configuration or remove the variable from env/docs to avoid dead config.

### 9. Symbol Action Counts Are Collected But Not Injected Into Active Prompts (LOW)
**Files:** `src/server/features/trading/execution/tradeWorkflow.ts`, `src/server/features/trading/prompting/promptBuilder.ts`
**Description:** `symbolActionCounts` is tracked in tool context and passed into prompt builder, but active prompts do not render a related section. `{{SYMBOL_ACTION_COUNT}}` appears only in archived prompt templates.
**Fix needed:** Either inject a compact symbol-action-count section into active prompts or remove unused prompt-builder plumbing.

---

## Priority Matrix

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| #1 Bracket-close DB reconciliation | High | 4h | P1 |
| #5 Scattered cache timings | Low | 1h | P3 |
| #6 Duplicated 5-minute interval | Low | 15m | P3 |
| #7 Leverage semantics drift | Low | 2-3h | P3 |
| #8 Unused workflow env var | Low | 15m | P3 |
| #9 Symbol action count prompt context | Low | 20m | P3 |

**Estimated total to fix remaining:** ~8-9 hours

---

*Related documentation: `AGENTS.md`.*
