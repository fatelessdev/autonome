# Frontend Chart Bandaids 🩹

This document tracks the frontend workarounds implemented to fix chart data issues caused by backend downsampling. The backend is deployed and immutable, so all fixes are client-side only.

## The Core Problem

The backend returns **downsampled portfolio history data** with time-based bucketing:
- ≤24h: 1-minute buckets
- ≤3d: 5-minute buckets  
- ≤7d: 15-minute buckets
- ≤30d: 1-hour buckets
- \>30d: 4-hour buckets

This causes:
1. **Stale chart tail** - The last data point can be hours behind the actual current value
2. **Uneven timestamp distribution** - When merging data sources, index-based sampling creates bunched timestamps
3. **Layout shift on variant switch** - Skeleton shows while data refetches, causing jarring UX

---

## Bandaid #1: Latest Value Stitching

**Problem**: Chart ends at stale downsampled value, not the true current price.

**Solution**: Fetch a separate high-resolution window (last 12 hours) and merge it onto the chart tail.

**Files**:
- [src/core/shared/markets/marketQueries.ts](src/core/shared/markets/marketQueries.ts) - `requestPortfolioLatest()` fetches 12h window
- [src/components/performance-graph.tsx](src/components/performance-graph.tsx) - `buildChartArtifacts()` merges latest data

**How it works**:
```
Historical (coarse) ──────────────────┬── Latest (fine, 12h) ──→ Current
                                      └── Merge point
```

---

## Bandaid #2: Time-Based Sampling

**Problem**: After merging coarse history + fine tail, the data has uneven density. Index-based sampling (every Nth point) creates bunched timestamps on the x-axis.

**Solution**: Time-based bucketing instead of index-based striding.

**File**: [src/core/shared/charts/chartSampler.ts](src/core/shared/charts/chartSampler.ts)

**How it works**:
1. Calculate total time range (first → last timestamp)
2. Divide into N equal time buckets (800 desktop, 400 mobile)
3. For each bucket, pick the closest actual data point
4. Result: uniform time distribution regardless of source data density

**Budget**:
- Desktop: 800 points
- Mobile: 400 points

---

## Bandaid #3: Aggregate Mode Timestamp Fix

**Problem**: In "All Variants" mode, fetching each variant separately and extracting single latest values caused different timestamps per model.

**Solution**: Fetch all variants into one array, then extract latest values from the merged set.

**File**: [src/core/shared/markets/marketQueries.ts](src/core/shared/markets/marketQueries.ts)

**Before**:
```typescript
// Each variant fetched separately → different timestamps
const perVariant = await Promise.all(ALL_VARIANTS.map(v => fetch(v)));
// Then averaged → timestamps don't match
```

**After**:
```typescript
// All variants merged first
const allEntries = [];
await Promise.all(ALL_VARIANTS.map(v => allEntries.push(...fetch(v))));
// Then extract latest → consistent timestamps
return computeLatestValues(allEntries);
```

---

## Bandaid #4: Variant Switch Layout Shift

**Problem**: When switching variants, the chart showed a skeleton while data refetched. The ModelLegend also refetched its own `latest` query, causing a double layout shift.

**Solution**: Use TanStack Query's `placeholderData` to keep previous data visible during transitions.

**Files**:
- [src/components/performance-graph.tsx](src/components/performance-graph.tsx)
- [src/components/model-legend.tsx](src/components/model-legend.tsx)

**How it works**:
```typescript
const { data } = useQuery({
  ...PORTFOLIO_QUERIES.history(variantParam),
  placeholderData: (prev) => prev, // Keep previous data during refetch
});

// Only show skeleton on initial load, not during variant transitions
const isPending = isHistoryPending && !portfolioData;
```

---

## What We Can't Fix (Without Backend Changes)

1. **Fine-grained data for entire range** - Backend already downsamples before sending. We can only add detail to the tail (via latest query), not the middle.

2. **True real-time updates** - Backend buckets data on write. Even with SSE, we only get notifications that data changed, then refetch the same downsampled data.

3. **Custom resolution per request** - Backend auto-detects resolution from time range. No parameter to request higher resolution.

---

## Ideal Backend Fix (For Future Reference)

If the backend could be modified, the proper fix would be:

```typescript
// Add optional resolution parameter to getPortfolioHistory
const data = await orpc.trading.getPortfolioHistory.call({
  variant,
  resolution: "1m", // Override auto-detection
  maxPoints: 1000,  // Let backend do smart downsampling (e.g., LTTB)
});
```

This would allow:
- Client requests specific resolution
- Backend applies proper downsampling algorithm (LTTB preserves shape better than time-bucket averaging)
- Single query instead of history + latest merge hack

---

## Files Modified

| File | Purpose |
|------|---------|
| `src/core/shared/charts/chartSampler.ts` | NEW - Time-based sampling utility |
| `src/core/shared/markets/marketQueries.ts` | Latest value fetching, aggregate mode fix |
| `src/components/performance-graph.tsx` | Merge latest data, sampling integration, placeholder data |
| `src/components/model-legend.tsx` | Placeholder data to prevent layout shift |
