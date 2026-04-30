# Future Plan & Backlog

**Last updated:** 2026-05-01

This document tracks planned features and improvements. All previously resolved items (minimum trade size, leverage caps, prompt deduplication, trade size auto-adjustment) have been implemented and removed.

---

## Planned Improvements
<!-- 
### 1. Tool Call Analyzer Disabled (CRITICAL)
**File:** `src/server/features/trading/tradeExecutor.ts:346-356`  
**Severity:** Critical  
**Description:** The entire `analyzeToolCallFailure` call is commented out:
```typescript
// analyzeToolCallFailure({
//   modelId: account.id,
//   ...
// }).catch((err) => { ... });
```
**Impact:** No detection of AI intent vs. execution mismatch. We're blind to tool call failures.

**Fix:** Uncomment and ensure the rewritten deterministic analyzer is working. -->

---

### Consensus Workflow (Future Implementation)
**Status:** Removed from codebase (was dead code) — preserved here for future consideration.
**Previous files:** `consensusOrchestrator.ts`, `consensusVoting.ts`
**Description:** A full consensus orchestrator (720 lines) existed but was never called in production. The code has been removed to reduce maintenance burden. If revived, implement as a 2-stage pipeline (screen → decide) rather than parallel voting.
**Effort:** 2-4 hours to re-implement from scratch

---

<!-- ### 5. No Output Sanitization Fallback (HIGH)
**File:** `src/server/features/trading/tradeExecutor.ts`  
**Severity:** High  
**Description:** If LLM returns malformed JSON, the entire invocation fails. No recovery attempt.

**Comparison:** AI-Trading-Agent uses a cheap sanitizer model to fix malformed outputs:
```python
def _sanitize_output(raw_content: str, assets_list):
    payload = {"model": self.sanitize_model, ...}  # gpt-4o-mini
```

**Fix:** Add sanitization pass using a cheap model before giving up. -->

---

<!-- ### 8. Confidence-Based Routing Not Implemented (MEDIUM)
**File:** `src/server/features/trading/tradeExecutor.ts`  
**Severity:** Medium  
**Description:** Per ultimate-plan.md:
```
Confidence >= 8: Full size
Confidence 6-7: 50% size
Confidence 4-5: Manual approval
Confidence < 4: Reject
```
But `confidence` field is passed through schema and never used for routing.

**Fix:** Add routing logic based on confidence thresholds. -->

---

<!-- ### 9. Circuit Breaker Missing (MEDIUM)
**File:** Missing - needs to be created  
**Severity:** Medium  
**Description:** Per ultimate-plan.md:
- 10% drawdown in 24h → reduce size 50%
- 20% drawdown in 24h → halt trading

`PortfolioSize` table exists but no circuit breaker logic.

**Fix:** Create `circuitBreaker.ts`, check at start of `runTradeWorkflow`. -->

---
