# Known Issues & Technical Debt

**Last updated:** 2026-01-26

This document tracks active issues in the Autonome codebase.

---

## Critical Issues

### 1. MAX_ACTIONS_PER_SYMBOL Disabled (CRITICAL)
**File:** `src/server/features/trading/agent/tools/types.ts:18`  
**Severity:** Critical  
**Description:** Safety feature completely disabled:
```typescript
// TODO: Re-enable symbol action limits later
export const MAX_ACTIONS_PER_SYMBOL = Infinity;
```
**Impact:** AI can execute unlimited actions per symbol, enabling the exact churn/position-flipping problem we're trying to prevent.

**Fix:** Set to `2` or `3` as originally intended.

---

### 2. Tool Call Analyzer Disabled (CRITICAL)
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

### 3. No Code-Level Cooldown Enforcement (CRITICAL)
**File:** `src/server/features/trading/agent/tools/createPositionTool.ts`  
**Severity:** Critical  
**Description:** Prompts tell AI to honor `cooldown_until` but there's no code check:
- No validation of cooldown timestamp before allowing position creation
- AI can ignore prompt rules and flip positions immediately

**Comparison:** AI-Trading-Agent has explicit cooldown tracking with timestamps. Bonerbots enforces hard cooldowns that reject orders.

**Fix:** Add before processing in `createPositionTool.ts`:
```typescript
const existingPosition = ctx.openPositions.find(p => p.symbol === symbol);
if (existingPosition?.exitPlan?.cooldownUntil) {
  const cooldownTime = new Date(existingPosition.exitPlan.cooldownUntil);
  if (new Date() < cooldownTime) {
    return `${symbol} is on cooldown until ${cooldownTime.toISOString()}`;
  }
}
```

---

### 4. No Per-Symbol Leverage Caps (CRITICAL)
**File:** Missing - needs to be created
**Severity:** Critical
**Description:** Autonome relies on a single `MAX_LEVERAGE` constant in prompts (often 50x+), but exchanges like Lighter/Binance have different limits per symbol (e.g., BTC 100x vs ALT 25x).
**Impact:** AI may request 50x on an altcoin capped at 25x, causing order rejection and failed workflow.

**Comparison:** Bonerbots has `leverageLimits.ts` mapping specific caps per symbol.

**Fix:** Create `leverageLimits.ts` and validate in `createPositionTool.ts`.

---

### 5. No Minimum Trade Size Validation (CRITICAL)
**File:** `src/server/features/trading/agent/tools/createPositionTool.ts`
**Severity:** Critical
**Description:** No check for minimum order value.
**Impact:** AI could open tiny $5 dust positions that are eaten by gas/fees or rejected by exchange.

**Comparison:** Bonerbots enforces $50 minimum.

**Fix:** Add `MINIMUM_TRADE_SIZE_USD = 50` constant and validation.

---

### 6. Consensus Workflow Dead Code (HIGH)
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

### 7. No Output Sanitization Fallback (HIGH)
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

### 8. No Position Reconciliation (HIGH)
**File:** Missing - needs to be created  
**Severity:** High  
**Description:** Internal DB state is never reconciled with exchange. If a position closes on exchange (SL/TP hit) but DB write fails, state diverges permanently.

**Comparison:** AI-Trading-Agent reconciles every cycle:
```python
for tr in active_trades[:]:
    if asset not in assets_with_positions and asset not in assets_with_orders:
        active_trades.remove(tr)  # Clean up stale state
```

**Fix:** Create `reconciliation.ts` that compares `getOpenPositions()` vs `getOpenOrdersByModel()`.

---

### 9. fetchIndicatorsTool Not Exposed (HIGH)
**File:** `src/server/features/trading/agent/tools/index.ts`  
**Severity:** High  
**Description:** TAAPI integration exists (`src/server/integrations/taapi/*`) but is only used for pre-fetching. AI cannot request additional indicators mid-reasoning.

**Comparison:** AI-Trading-Agent exposes `fetch_taapi_indicator` as a tool:
```python
tools = [{"function": {"name": "fetch_taapi_indicator", ...}}]
```

**Fix:** Create and expose `fetchIndicatorsTool` in the tools index.

---

## Medium Issues

### 10. Massive Code Duplication in createPosition.ts (MEDIUM)
**File:** `src/server/features/trading/createPosition.ts`  
**Severity:** Medium  
**Description:** 508 lines with two nearly identical paths:
- Simulator path: lines 52-222 (170 lines)
- Live path: lines 224-507 (283 lines)

Duplicated logic: scale-into-order, order creation, DB persistence, exit plan construction.

**Fix:** Extract common logic into helper functions.

---

### 11. Prompt Files Repeat Identical Sections (MEDIUM)
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

### 12. Fill Tracker No Retry Logic (MEDIUM)
**File:** `src/server/features/trading/fillTracker.ts`  
**Severity:** Medium  
**Description:** Single attempt to track fill, no retry on failure:
```typescript
if (!fillResult.success || !fillResult.filled) {
  results.push({ success: false, error: fillResult.error });
  continue;  // No retry
}
```

**Comparison:** AI-Trading-Agent confirms fills with wait + check.

**Fix:** Add exponential backoff retry (3 attempts).

---

### 13. Confidence-Based Routing Not Implemented (MEDIUM)
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

### 14. Circuit Breaker Missing (MEDIUM)
**File:** Missing - needs to be created  
**Severity:** Medium  
**Description:** Per ultimate-plan.md:
- 10% drawdown in 24h → reduce size 50%
- 20% drawdown in 24h → halt trading

`PortfolioSize` table exists but no circuit breaker logic.

**Fix:** Create `circuitBreaker.ts`, check at start of `runTradeWorkflow`.

---

### 15. No Trade Size Auto-Adjustment (MEDIUM)
**File:** `src/server/features/trading/agent/tools/createPositionTool.ts`
**Severity:** Medium
**Description:** If AI requests trade size > available balance, it likely fails.
**Comparison:** Bonerbots automatically adjusts size down to fit available margin.
**Fix:** Add logic to cap trade size at `availableBalance`.

---

## Low Issues

### 16. Fallback Values May Hide Errors
**File:** `src/server/features/trading/queries.server.ts:202-204`  
**Severity:** Low  
**Description:** Using `|| null` for parsing can mask corrupted data silently:
```typescript
const quantity = parseFloat(order.quantity) || null;
const entryPrice = parseFloat(order.entryPrice) || null;
```
If quantity is stored as `"abc"` (corrupted), it becomes `null` without logging.

**Recommendation:** Add logging when parse fails, or use stricter validation.

---

### 17. Missing Sign Defaults to SHORT in Live Positions
**File:** `src/server/features/trading/openPositions.ts:166`  
**Severity:** Low  
**Description:** Live positions map `sign` via:
```typescript
sign: accountPosition.sign === 1 ? "LONG" : "SHORT"
```
Any undefined/0/non-1 value becomes SHORT, potentially flipping direction if the exchange response shape changes.

**Recommendation:** Guard/validate `sign` explicitly or derive from quantity sign.

---

## Priority Matrix

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| #1 MAX_ACTIONS disabled | Critical | 5 min | P0 |
| #2 Tool analyzer disabled | Critical | 10 min | P0 |
| #3 No cooldown enforcement | Critical | 2 hours | P0 |
| #4 No leverage caps | Critical | 3 hours | P0 |
| #5 No minimum trade size | Critical | 30 min | P0 |
| #7 No output sanitizer | High | 4 hours | P1 |
| #8 No reconciliation | High | 3 hours | P1 |
| #9 fetchIndicatorsTool missing | High | 2 hours | P1 |
| #15 No trade size auto-adjust | Medium | 1 hour | P1 |
| #6 Consensus dead code | High | 1 hour | P2 |
| #10 createPosition duplication | Medium | 4 hours | P2 |
| #11 Prompt duplication | Medium | 2 hours | P2 |
| #12 Fill tracker no retry | Medium | 2 hours | P2 |
| #13 Confidence routing | Medium | 2 hours | P3 |
| #14 Circuit breaker | Medium | 3 hours | P3 |

**Estimated total to fix all:** ~30 hours

---

*Related documentation: See `AGENTS.md` for session notes and `ultimate-plan.md` for the full comparisons.*
