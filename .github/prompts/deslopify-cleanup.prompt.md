---
name: deslopify-cleanup
description: "Refactor a target code area to remove defensive/fallback noise, eliminate duplication, and clean sloppy code with fail-fast correctness. Use when: cleanup, deslopify, deduplicate, harden invariants, reduce tech debt."
argument-hint: "Target files/area and scope (e.g., src/server/features/trading balanced pass)"
agent: "agent"
---
Clean and harden the requested target area: **{{args}}**.

Follow repo rules in [AGENTS.md](../../AGENTS.md).

## Goal
Perform a focused cleanup pass that does all of the following in the target area:
1. Remove excessive defensive/fallback code that hides real errors.
2. Fix sloppy code (unclear flow, weak error handling, dead/redundant branches).
3. Eliminate duplication/repeated logic by introducing shared utilities.
4. Apply other maintainability improvements that reduce future bugs.

## Required Approach
1. Map the full touched surface first (types, callers, side effects, UI/API boundaries).
2. Prefer **fail-fast invariants** for required fields and critical paths.
3. Replace ad-hoc/duplicated helpers with shared canonical utilities.
4. Keep changes surgical; do not do unrelated refactors.
5. Do not remove or hide existing user-facing features unless explicitly requested.
6. Do not add compatibility shims or bandaid fallbacks.
7. Never revert unrelated working-tree changes.
8. Keep defensive checks that enforce invariants; remove fallback branches that only mask bad data/contracts.
9. In UI/query flows, prefer explicit error states over silent partial rendering from placeholder defaults.
10. For external providers (Alpaca/TAAPI/LLM APIs), allow retries only for transient failures with a default max of 2 retries (3 total attempts) and short exponential backoff.

## Trading-Specific Rule
For Alpaca trading execution paths, avoid permissive symbol coercion that silently normalizes legacy forms. Do not treat `BTC`, `BTCUSD`, and `BTC/USD` as equivalent through fallback behavior unless the path explicitly requires that behavior and it is documented as intentional.

## Validation (Mandatory)
Run and report results:
- `bunx tsc --noEmit`
- `bun run check`

If failures are unrelated to touched files, call that out explicitly.

## Output Format
Return a concise implementation report with:
1. **Changes Made**: file-by-file summary with why.
2. **Defensive Code Removed**: explicit fallback/guard patterns removed.
3. **Duplication Removed**: what was centralized and where.
4. **Behavioral Notes**: fail-fast changes and any intentional behavior shifts.
5. **Validation Results**: command outcomes.
6. **Follow-ups**: high-value next cleanup targets.

## Decision Rule
If an intended cleanup could reduce correctness, observability, or readability, do not apply it; explain why and choose the safer, cleaner alternative.
