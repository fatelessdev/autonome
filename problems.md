# Architectural Analysis & Technical Debt Report

**Date:** 2025-01-15
**Reviewer:** Claude (Senior SWE Persona)
**Scope:** `src/*`, `scripts/*` (Focus on Trading, Variants, and Data Flow)

## Executive Summary
The project demonstrates a high velocity of feature addition ("vibecoded"), but suffers from a lack of centralized definitions and clear separation of concerns. The most critical issue is the **Fragmentation of Truth**: core domain concepts (like Strategy Variants) are hardcoded in at least 6-7 different layers (DB, Zod, Config, Frontend normalization, UI logic, Utils), making extensions error-prone and brittle.

---

## 1. Violation of "Single Source of Truth" (SSOT)

### The "Variant" Problem
Adding or changing variants (e.g., changing from "Situational/Minimal/Guardian/Max/Sovereign" to "Guardian/Apex/Gladiator/Sniper/Trendsurfer/Contrarian") required touching **40+ files**. This is a red flag for high coupling and low cohesion.

*   **Issue:** The list of variants is repeated manually as:
    1.  **Database Enum:** `src/db/schema.ts`
    2.  **API Validation:** `src/server/orpc/schema.ts` (Zod enums)
    3.  **Backend Config:** `src/server/features/trading/prompts/variants.ts` (Keys in object)
    4.  **Frontend Normalization:** `src/core/shared/trading/dashboardQueries.ts` (String array checks)
    5.  **UI Components:** `src/routes/leaderboard.tsx`, `src/routes/analytics.tsx`, `src/routes/failures.tsx` (Tabs list, color styling)
    6.  **Utilities:** `src/core/utils/excelExport.ts` (Export logic)
    7.  **Styling Logic:** Distributed `if (variant === 'X')` checks for Tailwind classes across route files
    8.  **Seeder:** `scripts/seed.ts`
    9.  **Context Providers:** `src/components/variant-context.tsx`
    10. **Market Queries:** `src/core/shared/markets/marketQueries.ts`
    11. **Dashboard Types:** `src/core/shared/trading/dashboardTypes.ts`

*   **Recommendation:**
    *   Define a single `const VARIANTS` array or object in a shared core library (`src/domain/variants.ts`)
    *   Derive the TypeScript type `Variant` from this const using `as const` and `typeof`
    *   Derive the Zod schema from this const using `z.enum(VARIANT_IDS)`
    *   Pass this configuration to the frontend (via API or build-time shared file) to generate Tabs, Colors, and Labels dynamically
    *   Create a `getVariantColor(variant)` helper instead of inline conditionals

## 2. Weak Frontend-Backend Boundary Contract

### "Defensive" Data Normalization
*   **File:** `src/core/shared/trading/dashboardQueries.ts`, `src/core/shared/markets/marketQueries.ts`
*   **Issue:** The frontend code aggressively "normalizes" data coming from the API (e.g., `normalizePortfolioHistory`, `normalizeMarketPrice`). It manually checks `typeof x === 'string'` for fields that should be guaranteed by the API contract.
*   **Impact:** This adds massive bloat to the client bundle and maintenance overhead. Since you are using `orpc` (likely typed end-to-end), trust the types! If the API returns a number, the frontend shouldn't need to check if it's a number.
*   **Recommendation:** Rely on Zod schemas on the *server boundary* only. The frontend should consume the inferred type directly. Remove the manual normalization layers.

## 3. UI/Logic Coupling (Leaky Abstractions)

### Hardcoded Visual Logic
*   **File:** `src/server/features/trading/prompts/variants.ts` vs Frontend Components.
*   **Issue:** The backend defines a hex color (`#e11d48`), but the frontend components often hardcode Tailwind classes (`bg-rose-500`). Example from analytics.tsx:
    ```tsx
    variant === "Guardian" && "bg-purple-500/20 text-purple-600",
    variant === "Apex" && "bg-amber-500/20 text-amber-600",
    // ... repeated in 4+ files
    ```
*   **Impact:** Changing a variant's "theme" requires finding and replacing Tailwind classes across multiple UI files.
*   **Recommendation:**
    *   Create a centralized `VARIANT_STYLES` map in `variant-context.tsx` or a shared file
    *   Export a `getVariantClassName(variant)` utility
    *   Or map Variant ID -> Theme Token (e.g., `variant-guardian`) in a single CSS/Tailwind config file

## 4. Directory Structure & Modularization

### "Core" vs "Server" Confusion
*   **Observation:** The distinction between `src/core` and `src/server` is muddy.
    *   `src/core/shared` contains query options and types.
    *   `src/server/features` contains domain logic.
*   **Issue:** "Shared" folders often become dumping grounds. `marketQueries.ts` in "core/shared" contains React Query logic (`queryOptions`), which is strictly frontend-framework specific (React), yet it sits in "core/shared".
*   **Recommendation:**
    *   `src/domain`: Pure Typescript types and constants (Shared by FE/BE).
    *   `src/server`: API, DB, Business Logic.
    *   `src/client` (or `src/web`): React components, Hooks, React Query definitions.

## 5. Specific File Critiques

### `src/server/features/trading/tradeExecutor.ts` (Potential God Object)
*   **Risk:** While not fully analyzed in this session, files named `Executor` or `Manager` in this architecture tend to accumulate too many responsibilities (validation, execution, logging, notification). Ensure this file delegates to smaller services.

### `src/core/utils/excelExport.ts`
*   **Issue:** Contains presentation logic (column headers, specific formatting) mixed with data processing.
*   **Refactor:** The data transformation (Order -> CSV Row) should be separate from the Excel library implementation.

### `scripts/seed.ts`
*   **Issue:** The seeder logic repeats the knowledge of what variants exist. If a new variant is added, the seeder doesn't automatically know about it unless updated manually.
*   **Fix:** Import the canonical `VARIANTS` list from the source of truth to drive the seeding loop.

## 6. Type Safety Gaps

### Magic Strings in Analytics
*   **File:** `src/server/features/analytics/queries.server.ts`
*   **Issue:** SQL construction or filtering often relies on string literals matching the variant IDs. If a variant ID is renamed, the compiler might catch some, but runtime SQL queries might fail if they rely on raw strings.

### Repeated Type Definitions
*   **Issue:** The variant type union is defined in multiple places:
    ```typescript
    // In dashboardTypes.ts
    modelVariant?: "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian";
    
    // In dashboardQueries.ts  
    ["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian"].includes(record.modelVariant)
    
    // In marketQueries.ts
    variant?: "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian"
    ```
*   **Fix:** Import a single `Variant` type from a shared source.

---

## Roadmap to Remediation

1.  **Refactor Variants (High Priority):** Create `src/domain/variants.ts` to export the constant list and config. Update DB, Zod, and UI to derive from this.
2.  **Purge Normalizers:** Audit `dashboardQueries.ts` and remove manual type checking. Trust the `orpc` return types.
3.  **Centralize UI Config:** Move variant colors/labels into a single config map (or use the one from the backend) and create a `useVariantTheme(variantId)` hook.
4.  **Generate Zod from Config:** Use `z.enum([...VARIANT_IDS] as const)` derived from the centralized config.
5.  **DB Migration Strategy:** Consider using a reference table instead of a PostgreSQL enum for easier extensibility.
