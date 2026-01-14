# Architectural Analysis & Technical Debt Report

**Date:** 2025-01-20
**Reviewer:** Jules (Senior Software Engineer)
**Scope:** Full Stack (Agent, Simulator, API, Frontend, Infrastructure)

## Executive Summary
The project is a high-velocity, "vibecoded" prototype that successfully demonstrates a complex Agentic Trading loop with a custom Simulator. However, it suffers from critical "Blind Spots" in the Agent's decision-making context, dangerous data inconsistencies between the Database and Exchange, and a fragmented "Source of Truth" for domain concepts.

---

## 1. Critical: Agent "Brain" Gaps

### Hallucinated Indicators (The "Blind Pilot" Problem)
*   **Issue:** The Agent prompts (e.g., `Guardian`) explicitly require specific indicators to make decisions:
    > "Price must be **Outside the Ichimoku Cloud**."
    > "**ADX < 40**."
*   **Reality:** These indicators (`Ichimoku`, `ADX`, `Supertrend`, `Bollinger`) are **NOT calculated** in `indicators.ts` nor passed in `marketData.ts`.
*   **Impact:** The Agent is hallucinating these values or guessing based on raw price action, leading to random adherence to its own strict rules.
*   **Fix:** Implement `getIchimoku`, `getAdx` in `indicators.ts` and add them to the `MarketSnapshot` passed to the LLM.

### Missing "Reasoning" Tracking
*   **Issue:** The system tracks *what* the agent did (Orders, Trades) and *if* it failed (Failures), but not *why* it succeeded.
*   **Impact:** We cannot quantitatively analyze why a specific model is winning. Is it respecting the "Cloud"? We don't know because the reasoning is lost in the unstructured chat logs.
*   **Fix:** Add a `reasoning_tags` or `strategy_compliance` JSON field to the `ToolCalls` or `Orders` table to capture structured rationale (e.g., `{"setup": "pullback_ema50", "trend": "bullish"}`).

---

## 2. Architecture & Data Integrity

### Fragmentation of Truth (The "Variant" Problem)
*   **Issue:** "Variants" (Guardian, Apex, etc.) are defined in `variants.ts`, but their existence is implicitly assumed in:
    1.  **Database:** `model_variant` enum (implied).
    2.  **Frontend:** Hardcoded styles (`bg-purple-500` for Guardian) in `analytics.tsx`.
    3.  **Prompts:** Hardcoded list in `variants.ts`.
*   **Impact:** Adding a new strategy requires touching 10+ files across the stack.
*   **Fix:** Create a `src/domain/variants.ts` as the single SSOT. Export a `VariantConfig` object that includes the `id`, `prompt`, `color_hex`, and `label`. Frontend should consume this config dynamically.

### Database vs. Exchange Drift
*   **Issue:** The "Scale-In" logic in `createPosition.ts` relies on `getOpenOrderBySymbol` (Local DB) to calculate the new Weighted Average Entry Price.
*   **Risk:** If the DB misses an update (e.g., a liquidation or manual close on the exchange), the Agent will calculate entry prices based on stale data, leading to incorrect P&L assumptions and potential catastrophic risk sizing.
*   **Fix:** Always fetch the *current* position from the Exchange (Lighter SDK) before calculating a scale-in. Use the DB only for "Intent" tracking.

### Implicit "SHORT" Default
*   **File:** `src/server/features/trading/openPositions.ts`
*   **Issue:** `sign: accountPosition.sign === 1 ? "LONG" : "SHORT"`
*   **Risk:** If the exchange returns `0` (flat) or any other code, the system defaults to `SHORT`. This could cause the UI to show a Short position when the account is actually flat.
*   **Fix:** Explicitly handle `1` (Long), `-1` (Short), and `0` (Flat). Throw or log warning on unknown values.

---

## 3. Infrastructure & DevOps

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

## 4. UI/UX & Frontend

### Hardcoded Visual Logic
*   **File:** `src/routes/analytics.tsx`
*   **Issue:** Styling logic (colors for variants) is hardcoded in the component.
*   **Fix:** Move styling to the shared `VariantConfig`.

### Markdown Leakage
*   **File:** `src/server/features/trading/marketData.ts`
*   **Issue:** The backend formats data into Markdown (`### MARKET DATA`) for the LLM.
*   **Tech Debt:** This couples the Data Layer to the Presentation Layer (Prompt). If we want to change the prompt format (e.g., to JSON), we have to refactor the data service.
*   **Fix:** Return structured objects from `marketData.ts` and let `promptBuilder.ts` handle the string formatting.

---

## 5. Verified Bugs (From POTENTIAL_BUGS.md)

1.  **Live Trading Fill Tracking**: `createPosition.ts` assumes the order fills completely at the requested quantity. It does not verify the actual fill amount from the exchange.
2.  **Fallback Hiding**: `parseFloat(...) || null` in `queries.server.ts` can mask data corruption.

---

## Recommendations Roadmap

1.  **Immediate Fix:** Implement `Ichimoku` and `ADX` indicators to unblind the Agent.
2.  **Immediate Fix:** Fix the "Implicit SHORT" bug in `openPositions.ts`.
3.  **Refactor:** Centralize `VARIANTS` config (including colors) and refactor Frontend/Backend to use it.
4.  **Refactor:** Switch `marketData.ts` to return JSON, moving Markdown formatting to `promptBuilder.ts`.
5.  **Infrastructure:** Change `db:push` to `db:migrate` in `docker-compose.yml`.
