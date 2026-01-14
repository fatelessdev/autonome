# Architectural Analysis & Technical Debt Report

**Date:** 2026-01-05
**Reviewer:** Jules (Senior Software Engineer)
**Scope:** Full Stack (Agent, Simulator, API, Frontend, Infrastructure)

## Severity Levels
- 🔴 **Critical**: Immediate action required (Data loss, hallucination, financial risk).
- 🟡 **Warning**: Address soon (Tech debt, maintenance overhead).
- 🔵 **Info**: Optimization opportunities.

---

## 1. 🔴 Critical: Agent "Brain" Gaps

### Hallucinated Indicators (The "Blind Pilot" Problem)
*   **Issue:** The Agent prompts (e.g., `Guardian`) explicitly require specific indicators (`Ichimoku`, `ADX`) to make decisions.
*   **Reality:** While `taapi` integration exists in `src/server/integrations/taapi`, the `marketData.ts` service (which builds the main prompt context) **does NOT include** these indicators in the `MARKET_DATA` block.
*   **Impact:** The Agent is "hallucinating" these values or guessing based on raw price action, leading to random adherence to its own strict rules.
*   **Fix:** Inject `taapi` data into the `MarketSnapshot` in `marketData.ts` or ensure `fetchIndicators` tool is mandatorily called before decision-making.

### SL/TP Exchange Drift (The "Silent Killer")
*   **File:** `src/server/features/trading/agent/tools/updateExitPlanTool.ts`
*   **Issue:** If `updateSlTpOrdersOnExchange` fails (e.g., network error), the code catches the error, logs it, and **proceeds to update the Database** with the new SL/TP.
*   **Risk:** The Agent and DB believe the Stop Loss is tightened, but the Exchange still has the old (or no) Stop Loss. This is a critical state drift that could lead to unexpected liquidation.
*   **Fix:** If Exchange update fails, **rethrow the error** and do NOT update the DB. Fail the tool call explicitly.

---

## 2. 🟡 Architecture & Data Integrity

### Fragmentation of Truth (The "Variant" Problem)
*   **Issue:** "Variants" (Guardian, Apex, etc.) are defined in `variants.ts`, but their existence is implicitly assumed in:
    1.  **Database:** `model_variant` enum (implied).
    2.  **Frontend:** Hardcoded styles (`bg-purple-500` for Guardian) in `analytics.tsx`.
    3.  **Prompts:** Hardcoded list in `variants.ts`.
*   **Impact:** Adding a new strategy requires touching 10+ files across the stack.
*   **Fix:** Create a `src/domain/variants.ts` as the single SSOT. Export a `VariantConfig` object that includes the `id`, `prompt`, `color_hex`, and `label`. Frontend should consume this config dynamically.

### Database vs. Exchange Drift (Scale-In)
*   **Issue:** The "Scale-In" logic in `createPosition.ts` relies on `getOpenOrderBySymbol` (Local DB) to calculate the new Weighted Average Entry Price.
*   **Risk:** If the DB misses an update (e.g., a liquidation or manual close on the exchange), the Agent will calculate entry prices based on stale data, leading to incorrect P&L assumptions.
*   **Fix:** Always fetch the *current* position from the Exchange (Lighter SDK) before calculating a scale-in. Use the DB only for "Intent" tracking.

### Implicit "SHORT" Default
*   **File:** `src/server/features/trading/openPositions.ts`
*   **Issue:** `sign: accountPosition.sign === 1 ? "LONG" : "SHORT"`
*   **Risk:** If the exchange returns `0` (flat) or any other code, the system defaults to `SHORT`.
*   **Fix:** Explicitly handle `1` (Long), `-1` (Short), and `0` (Flat). Throw or log warning on unknown values.

---

## 3. 🟡 Infrastructure & DevOps

### Risky Production Deployment
*   **File:** `docker-compose.yml`
*   **Issue:** Uses `bun run db:push` in the `migrate` service.
*   **Risk:** `db:push` can destructively alter the schema and lose data if the schema changes are incompatible. It is intended for prototyping.
*   **Fix:** Switch to `bun run db:migrate` for controlled, versioned migrations in production.

### Docker Build Strategy
*   **Issue:** The `Dockerfile` builds the API but relies on `Vite` (implied Vercel) for the frontend. The `docker-compose` only runs the backend.
*   **Confusion:** A developer might expect `docker-compose up` to start the full stack, but it only starts the API.
*   **Fix:** Update `README.md` to clearly state the Hybrid deployment model (Vercel + VPS).

---

## 4. 🔵 Code Quality & Standards

### Weak Frontend-Backend Boundary
*   **File:** `src/core/shared/trading/dashboardQueries.ts`
*   **Issue:** Aggressive "Defensive" Data Normalization (checking `typeof x === 'string'` for every field).
*   **Impact:** Adds massive bloat. Since `orpc` provides end-to-end type safety, we should trust the types on the boundary and remove manual runtime checks in the UI layer.

### Directory Structure & Modularization
*   **Observation:** `src/core` vs `src/server` distinction is muddy.
    *   `src/core/shared` contains React Query logic (`queryOptions`), which is framework-specific, yet sits in "core".
*   **Recommendation:**
    *   `src/domain`: Pure Typescript types/constants (Shared).
    *   `src/server`: API, DB, Business Logic.
    *   `src/client`: React components, Hooks, React Query.

### Specific File Critiques
*   **`src/server/features/trading/tradeExecutor.ts`**: A potential "God Object" accumulating too many responsibilities (execution, logging, notification, retries). Needs decomposition.
*   **`src/core/utils/excelExport.ts`**: Mixes presentation logic with data processing.

### Type Safety Gaps
*   **Magic Strings**: `src/server/features/analytics/queries.server.ts` uses raw string literals for SQL.
*   **Repeated Types**: Variant unions duplicated across `dashboardTypes.ts`, `marketQueries.ts`.

---

## 5. 🔴 Verified Bugs (From POTENTIAL_BUGS.md)

1.  **Live Trading Fill Tracking**: `createPosition.ts` assumes the order fills completely at the requested quantity. It does not verify the actual fill amount from the exchange.
2.  **Fallback Hiding**: `parseFloat(...) || null` in `queries.server.ts` can mask data corruption.

---

## Recommendations Roadmap

1.  **Immediate Fix:** Inject `taapi` indicators into `MarketSnapshot` to fix the "Brain Gap".
2.  **Immediate Fix:** Add `throw` on exchange failure in `updateExitPlanTool` to prevent DB/Exchange drift.
3.  **Refactor:** Centralize `VARIANTS` config (including colors) and refactor Frontend/Backend to use it.
4.  **Refactor:** Switch `marketData.ts` to return JSON, moving Markdown formatting to `promptBuilder.ts`.
5.  **Infrastructure:** Change `db:push` to `db:migrate` in `docker-compose.yml`.
