# Known Issues & Technical Debt

**Last updated:** 2026-01-27

This document tracks active issues in the Autonome codebase.

---

## High Issues

### 1. Fill Tracker No Retry Logic (HIGH)
**File:** `src/server/features/trading/fillTracker.ts`  
**Severity:** High  
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

## Low Issues

### 2. Fallback Values May Hide Errors
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

### 3. Missing Sign Defaults to SHORT in Live Positions
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
| #1 Fill tracker no retry | High | 2 hours | P1 |
| #2 Fallback values | Low | 30 min | P3 |
| #3 Missing sign check | Low | 30 min | P3 |

**Estimated total to fix all:** ~3 hours

---

*Related documentation: See `AGENTS.md` for architecture overview and `ultimate-plan.md` for feature roadmap.*
