# Autonome Developer Guide (AGENTS.md)

**Scope:** This document applies to all AI Agents (Claude, Copilot, etc.) and Human Developers working on the `autonome` repository.

## 1. Core Philosophy: "Single Source of Truth" (SSOT)
*   **Problem:** The codebase suffers from fragmentation (e.g., Variants defined in DB, Types, and Config).
*   **Rule:** When defining a domain concept (like a Strategy Variant or Market), define it **ONCE** in a shared configuration file (e.g., `src/domain/variants.ts`) and derive everything else (Types, Zod Schemas, DB Enums, UI Configs) from that single object.
*   **Do Not:** Hardcode magic strings or duplicate lists across files.

## 2. Tech Stack & Tools
*   **Runtime:** **Bun** (v1.1+). Use `bun install`, `bun run`. Never use `npm` or `pnpm`.
*   **Framework:** TanStack Start (Frontend), Hono (Backend API).
*   **API Layer:** **oRPC**. Always use defined procedures. Never use raw `fetch` or REST endpoints unless integrating with a 3rd party SDK.
*   **Database:** PostgreSQL + Drizzle ORM.
    *   **Identifiers:** Always quote table/column names in schema definition: `pgTable("Models", ...)`
    *   **Migrations:** Use `bun run db:migrate` for production. `bun run db:push` is for local prototyping ONLY.

## 3. Architecture & Patterns

### A. The "Brain" (Agent Logic)
*   **Inputs Matter:** Before asking an Agent to "check Ichimoku Cloud", **VERIFY** that the `Ichimoku` indicator is actually calculated and passed in the `MARKET_INTELLIGENCE` string. Do not assume the LLM can "see" the chart.
*   **State:** The Agent is stateless between runs but maintains state *within* a run via the `messages` array. Use `rebuildUserPrompt` to inject fresh market data into the context loop.

### B. The "Body" (Execution)
*   **Simulator vs. Live:** Logic should be agnostic where possible.
    *   **Warning:** In Live Mode, `createOrder` does NOT return fill details immediately. You must fetch the trade execution separately.
    *   **Warning:** Do not rely on Local DB state for critical logic (like Scale-In pricing). Always fetch the authoritative state from the Exchange (Lighter SDK) or Simulator memory.

### C. The "View" (Frontend)
*   **No Logic in UI:** Do not calculate "Sharpe Ratio" or "Aggregate Stats" in React components. Do it on the server (Drizzle/SQL) and pass the result via oRPC.
*   **Styling:** Do not hardcode Tailwind classes for dynamic data (e.g., `bg-purple-500` for "Guardian"). Derive styles from the shared Config.

## 4. Coding Standards (Strict)
*   **Linting:** Follow `biome.json`. No unused variables, no `any` (unless absolutely necessary and commented).
*   **Types:** Trust the inferred types from Drizzle and oRPC. Do not manually type-cast unless fixing a library bug.
*   **Environment:** Use `src/env.ts` (T3Env). Never access `process.env` directly in application code.

## 5. Critical "Do Not's"
1.  **Do Not** blindly trust the "Reasoning" in chat logs. It is unstructured. If you need to track *why* a trade happened, add a structured field to the database.
2.  **Do Not** assume `1` is the only "Long" sign. Exchange APIs are weird. Handle `1` (Long), `-1` (Short), and `0` (Flat) explicitly.
3.  **Do Not** leave "TODO" comments without a plan. If you find a bug, fix it or document it in `problems.md`.

## 6. Deployment
*   **Hybrid Model:** Frontend -> Vercel. Backend -> VPS (Docker).
*   **Secrets:** Managed via `.env` (Local) and Vercel/VPS env vars (Prod).

---

**Note to AI Agents:** If you are asked to implement a feature, first check `problems.md` to ensure you aren't building on top of known technical debt without addressing it.
