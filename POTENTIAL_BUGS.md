# Potential Bugs & Logic Issues in Autonome

This document catalogs subtle/niche bugs and potential issues discovered in the codebase that could lead to incorrect behavior, data inconsistencies, or unexpected failures.

---

## ✅ FIXED BUGS

### 1. Order Book Synthetic Liquidity Too Low (FIXED)
**File:** `src/server/features/simulator/market.ts:29`  
**Status:** ✅ Fixed  
**Description:** The synthetic order book was created with `quantity: 1` per price level. This meant:
- Orders for 1000+ units would only fill 1 unit
- P&L calculations would be based on 1 unit
- Margin checks passed because only 1 unit was validated

**Fix Applied:** Changed to `100_000_000 / price` to provide ~$100M of liquidity.

### 2. Database Storing Requested Quantity Instead of Filled Quantity (FIXED)
**File:** `src/server/features/trading/createPosition.ts:168`  
**Status:** ✅ Fixed  
**Description:** When creating orders in DB, the code stored `orderQuantity` (what AI requested) instead of `execution.totalQuantity` (what actually filled). This caused:
- UI showing wrong position sizes
- P&L appearing incorrect
- Notional values being wildly off

**Fix Applied:** Now uses `filledQuantity = execution.totalQuantity` for DB storage.

---

## ⚠️ KNOWN ISSUES / TODOs

### 3. Live Trading Doesn't Track Fill Quantity
**File:** `src/server/features/trading/createPosition.ts`  
**Severity:** Medium  
**Description:** In live trading mode, the code stores `orderQuantity` (requested) because the Lighter exchange's `createOrder()` doesn't return fill details. If an order partially fills, the DB will have incorrect quantity.

**Recommendation:** After placing order, query the exchange for actual fill details.

---

## ✅ FIXED VALIDATION GAPS

### 6. No Quantity Validation in AI Decision Schema (FIXED)
**File:** `src/server/features/trading/agent/schemas.ts`  
**Status:** ✅ Fixed  
**Description:** The Zod schema accepted any number for quantity without bounds.

**Fix Applied:** Added `.positive().max(100_000)` validation with clear description.

### 7. No Leverage Validation in Schema (FIXED)
**File:** `src/server/features/trading/agent/schemas.ts`  
**Status:** ✅ Fixed  
**Description:** Leverage accepted any number despite description saying "1-10x".

**Fix Applied:** Added `.min(1).max(20)` validation (expanded to 20x for flexibility).

### 8. No Confidence Bounds in Schema (FIXED)
**File:** `src/server/features/trading/agent/schemas.ts`  
**Status:** ✅ Fixed  
**Description:** Confidence should be 0-100 but had no validation.

**Fix Applied:** Added `.min(0).max(100)` validation.

### 9. Quantity Parsing Accepts Notional as Base Size (FIXED)
**File:** `src/server/features/trading/tradingDecisions.ts`  
**Status:** ✅ Fixed  
**Description:** When normalizing tool-call decisions, `quantity` fell back to `record.notional` and `record.amount`. If a model returned notional in USD, it was treated as base-asset size, leading to massively oversized orders.

**Fix Applied:** Removed `notional`/`amount` fallback. Now only accepts explicit size fields: `quantity`, `size`, `baseAmount`.

---

## 🔄 DATA CONSISTENCY ISSUES

### 10. Fallback Values May Hide Errors
**File:** `src/server/features/trading/queries.server.ts:195-196`  
**Severity:** Low  
**Description:** Using `|| null` or `|| 0` for parsing can mask bad data:
```typescript
const quantity = parseFloat(order.quantity) || null;
const entryPrice = parseFloat(order.entryPrice) || null;
```

**Issue:** If quantity is stored as "abc" (corrupted), it becomes `null` silently.

### 11. P&L Calculation Fallback Logic
**File:** `src/server/features/trading/closePosition.ts:79-85`  
**Severity:** Medium  
**Description:** If price data is missing, P&L falls back to realized + unrealized:
```typescript
let netPnl: number | null = null;
if (entryPrice != null && resolvedExitPrice != null && absQuantity != null) {
    netPnl = (isLong ? resolvedExitPrice - entryPrice : entryPrice - resolvedExitPrice) * absQuantity;
} else if (realizedPnl != null || unrealizedPnl != null) {
    netPnl = (realizedPnl ?? 0) + (unrealizedPnl ?? 0);  // Fallback may be stale/wrong
}
```

---

## 🧪 SIMULATOR-SPECIFIC ISSUES

### 12. Account State Clone Doesn't Deep Clone exitPlan
**File:** `src/server/features/simulator/accountState.ts:35-41`  
**Severity:** Low  
**Description:** The `clone()` method does shallow copy of `exitPlan`:
```typescript
copy.positions.set(symbol, {
    ...position,
    exitPlan: position.exitPlan ? { ...position.exitPlan } : null,
});
```
This is actually correct (shallow spread), but nested objects in exitPlan would share references.

---

## 📊 POTENTIAL EDGE CASES

### 13. Scale-In Exit Plan Not Updated (FIXED)
**File:** `src/server/features/trading/createPosition.ts`  
**Status:** ✅ Fixed  
**Description:** When scaling into an existing position, the old exit plan (stop/target/invalidation) was preserved even when the AI provided new values. The `??` operator meant new values only applied if the existing value was null.

**Fix Applied:** Exit plan logic now properly uses new values when provided, falling back to existing values only when new values are null/undefined.

### 15. Missing Sign Defaults to SHORT in Live Positions
**File:** `src/server/features/trading/openPositions.ts:99-114`  
**Severity:** Low  
**Description:** Live positions map `sign` via `accountPosition.sign === 1 ? "LONG" : "SHORT";` so any undefined/0/non-1 value becomes SHORT, potentially flipping direction if the exchange shape changes.

**Recommendation:** Guard/validate `sign` or derive from quantity where available.

---

## 📝 RECOMMENDATIONS

1. **Add input validation to AI schema** - Enforce sensible bounds on quantity, leverage, confidence
2. **Implement fill tracking for live trading** - Query exchange for actual execution details
---

*Last updated: 2026-01-10*
*Related fix commit: Fixed order book liquidity + DB quantity storage*
