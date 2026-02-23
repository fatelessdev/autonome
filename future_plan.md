# Future Plan & Backlog

**Last updated:** 2026-01-27

This document tracks planned features and improvements moved from known issues.

---

## Planned Improvements

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

**Fix:** Uncomment and ensure the rewritten deterministic analyzer is working.

---

### 2. No Per-Symbol Leverage Caps (CRITICAL)
**File:** Missing - needs to be created
**Severity:** Critical
**Description:** Autonome relies on a single `MAX_LEVERAGE` constant in prompts (often 50x+), but exchanges like Lighter/Binance have different limits per symbol (e.g., BTC 100x vs ALT 25x).
**Impact:** AI may request 50x on an altcoin capped at 25x, causing order rejection and failed workflow.

**Comparison:** Bonerbots has `leverageLimits.ts` mapping specific caps per symbol.

**Fix:** Create `leverageLimits.ts` and validate in `createPositionTool.ts`.

---

### 3. No Minimum Trade Size Validation (CRITICAL)
**File:** `src/server/features/trading/agent/tools/createPositionTool.ts`
**Severity:** Critical
**Description:** No check for minimum order value.
**Impact:** AI could open tiny $5 dust positions that are eaten by gas/fees or rejected by exchange.

**Comparison:** Bonerbots enforces $50 minimum.

**Fix:** Add `MINIMUM_TRADE_SIZE_USD = 50` constant and validation.

---

### 4. Consensus Workflow Dead Code (HIGH)
**File:** `src/server/features/trading/orchestrator.ts` + `tradeExecutor.ts:389-390`  
**Severity:** High  
**Description:** Consensus model is filtered out but never actually executed:
```typescript
const consensusModel = models.find((m) => m.name === CONSENSUS_MODEL_NAME);
// ... consensusModel is never used after this
```
**Impact:** `runConsensusWorkflow` exists but is never called. Dead code.

**Fix:** Either implement the consensus trigger or remove the dead code.

---

### 5. No Output Sanitization Fallback (HIGH)
**File:** `src/server/features/trading/tradeExecutor.ts`  
**Severity:** High  
**Description:** If LLM returns malformed JSON, the entire invocation fails. No recovery attempt.

**Comparison:** AI-Trading-Agent uses a cheap sanitizer model to fix malformed outputs:
```python
def _sanitize_output(raw_content: str, assets_list):
    payload = {"model": self.sanitize_model, ...}  # gpt-4o-mini
```

**Fix:** Add sanitization pass using a cheap model before giving up.

---

### 7. Prompt Files Repeat Identical Sections (MEDIUM)
**Files:** `src/server/features/trading/prompts/prompt1.ts` through `prompt5.ts`  
**Severity:** Medium  
**Description:** Each file contains identical:
- HYSTERESIS RULE section
- COOLDOWN MECHANISM section  
- EXIT PLAN REQUIREMENTS section
- REASONING FRAMEWORK section

**Impact:** Updates require changing 5+ files (already happened per implementation log).

**Fix:** Create `promptBase.ts` with shared rules, compose into individual prompts.

---

### 8. Confidence-Based Routing Not Implemented (MEDIUM)
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

**Fix:** Add routing logic based on confidence thresholds.

---

### 9. Circuit Breaker Missing (MEDIUM)
**File:** Missing - needs to be created  
**Severity:** Medium  
**Description:** Per ultimate-plan.md:
- 10% drawdown in 24h → reduce size 50%
- 20% drawdown in 24h → halt trading

`PortfolioSize` table exists but no circuit breaker logic.

**Fix:** Create `circuitBreaker.ts`, check at start of `runTradeWorkflow`.

---

### 10. No Trade Size Auto-Adjustment (MEDIUM)
**File:** `src/server/features/trading/agent/tools/createPositionTool.ts`
**Severity:** Medium
**Description:** If AI requests trade size > available balance, it likely fails.
**Comparison:** Bonerbots automatically adjusts size down to fit available margin.
**Fix:** Add logic to cap trade size at `availableBalance`.

---
