# Trading Feature Structure

This folder contains trading domain logic grouped by responsibility.

## Naming Rules

- Use noun-based module names (`portfolio`, `positions`, `tradeWorkflow`) and avoid `get*` prefixes.
- Keep server adapters/query option modules suffixed as `.server.ts`.
- Keep DB lifecycle metadata in DB repositories; Alpaca remains authoritative for live account/position state.
- Keep SSE payload types and channels in `events/`.
- Keep AI prompt templates under `prompting/prompts/` and prompt composition in `prompting/`.

## Current Layout

- `contracts/`: shared trading types and contracts (`accounts`, decisions, invocation payload shapes).
- `data/`: portfolio/positions reads, market intelligence, enrichment, and query adapters.
- `analysis/`: derived analytics used during decisioning (`performanceMetrics`, competition context).
- `execution/`: order execution and workflow orchestration (`createPosition`, `closePosition`, `tradeWorkflow`).
- `prompting/`: prompt templates and prompt-building logic.
- `agent/`: trade agent factory, tool schemas, and tool implementations.
- `events/`: trading SSE event definitions and payload mappers.

## Guidance

- Add new files to the matching domain folder instead of the trading root.
- Prefer absolute imports (`@/server/features/trading/...`) for cross-domain references.
- Remove dead helpers quickly to avoid stale compatibility clutter.
