# Known Issues & Technical Debt

**Last updated:** 2026-05-01

This file lists open issues and future work items. All previously listed items have been resolved — see `AGENTS.md` for the current architecture and conventions.

---

## Future Work

### Symbol Action Counts — Re-Inject Into Prompts
**Files:** `src/server/features/trading/agent/tools/types.ts` (`MAX_ACTIONS_PER_SYMBOL = 3`)
**Description:** The `symbolActionCounts` plumbing was removed from the codebase because active prompts never rendered the section. The `MAX_ACTIONS_PER_SYMBOL` constant remains in `types.ts` for future re-introduction. When ready to re-enable: rebuild the tracking in `tradeWorkflow.ts`, pass into `promptBuilder.ts`, and create a compact prompt section so the LLM sees per-symbol action usage.
**Status:** Dormant — constant preserved, tracking removed.

---

*Related documentation: `AGENTS.md`.*
