# Server DB Ownership Matrix

This directory is split by persistence responsibility.

## Module Ownership

- `tradingRepository.ts`
  - Owns invocations/tool calls/model metrics/portfolio snapshots.
  - Tables: `"Invocations"`, `"ToolCalls"`, `"Models"`, `"PortfolioSize"`.
  - Used by trading execution and analytics.

- `tradingRepository.server.ts`
  - Server-side query/mutation wrappers around `tradingRepository.ts`.
  - Exposes cache-aware query options and semantic mutation helpers.

- `ordersRepository.server.ts`
  - Owns order/position lifecycle state.
  - Table: `"Orders"`.
  - Used by create/close position flows and performance analysis.

- `variantsRepository.server.ts`
  - Owns read-only queries for the variants oRPC router.
  - Tables: `"Models"`, `"Orders"`, `"PortfolioSize"` (read-only cross-table queries).
  - Functions: `getVariantModelIds()`, `getClosedOrdersByModelIds()`, `getPortfolioHistoryByModelIds()`.
  - Used by `src/server/orpc/router/variants.ts` — the router has no direct db imports.

## Boundary Rules

- Feature code should prefer `*.server.ts` wrappers for query options and semantic mutations.
- Keep multi-table operations explicit and transactional when possible.
- Keep symbol semantics unchanged unless a dedicated migration plan is approved.

## Usage Notes

- `tradingRepository.ts` and `ordersRepository.server.ts` are intentionally separate; they do not depend on each other directly.
- When adding a new persistence concern, choose one owner module and document it here.