import { describe, expect, it } from "vitest";
import {
	ANNUALIZATION_FACTOR,
	MIN_SHARPE_SAMPLES,
	computePeriodReturn,
	computeSharpeFromWelford,
	createWelfordState,
	deserializeWelfordState,
	serializeWelfordState,
	welfordStdDev,
	welfordUpdate,
	welfordVariance,
} from "./welford";

// ==================== Known Values ====================
// Reference values computed with Python's statistics module (ddof=1):
//
// data = [2, 4, 4, 4, 5, 5, 7, 9]
// mean(data)           = 5.0
// variance(data, ddof=1) = 32/7 ≈ 4.5714  (sample variance)
// stdev(data, ddof=1)  ≈ 2.1381
//
// data2 = [-3, -1, 1, 3]
// mean(data2)          = 0.0
// variance(data2, ddof=1) = 20/3 ≈ 6.6667

describe("Welford's Online Algorithm", () => {
	describe("createWelfordState", () => {
		it("creates an empty state with zero values", () => {
			const state = createWelfordState();
			expect(state.mean).toBe(0);
			expect(state.m2).toBe(0);
			expect(state.count).toBe(0);
		});
	});

	describe("welfordUpdate", () => {
		it("handles a single observation", () => {
			const state = createWelfordState();
			welfordUpdate(state, 5.0);
			expect(state.count).toBe(1);
			expect(state.mean).toBe(5.0);
			expect(state.m2).toBe(0); // no deviation with 1 sample
		});

		it("computes correct mean for two observations", () => {
			const state = createWelfordState();
			welfordUpdate(state, 2.0);
			welfordUpdate(state, 4.0);
			expect(state.count).toBe(2);
			expect(state.mean).toBe(3.0);
		});

		it("matches known values for [2, 4, 4, 4, 5, 5, 7, 9]", () => {
			const data = [2, 4, 4, 4, 5, 5, 7, 9];
			const state = createWelfordState();
			for (const val of data) {
				welfordUpdate(state, val);
			}

			// Mean = 5.0
			expect(state.mean).toBeCloseTo(5.0, 10);
			// Sample variance (ddof=1) = 32/7 ≈ 4.5714
			expect(welfordVariance(state)).toBeCloseTo(32 / 7, 10);
			// Sample stddev = sqrt(32/7) ≈ 2.1381
			expect(welfordStdDev(state)).toBeCloseTo(Math.sqrt(32 / 7), 10);
		});

		it("is numerically stable with large offset values", () => {
			// Classic numerical instability test: values near 1e9 with small differences
			const state = createWelfordState();
			const offset = 1e9;
			const data = [offset + 1, offset + 2, offset + 3, offset + 4, offset + 5];

			for (const val of data) {
				welfordUpdate(state, val);
			}

			// Mean should be offset + 3
			expect(state.mean).toBeCloseTo(offset + 3, 6);
			// Sample variance of [1,2,3,4,5] = 2.5
			expect(welfordVariance(state)).toBeCloseTo(2.5, 6);
		});

		it("handles negative values", () => {
			const state = createWelfordState();
			welfordUpdate(state, -3);
			welfordUpdate(state, -1);
			welfordUpdate(state, 1);
			welfordUpdate(state, 3);

			expect(state.mean).toBeCloseTo(0, 10);
			// Sample variance (ddof=1) = 20/3 ≈ 6.6667
			expect(welfordVariance(state)).toBeCloseTo(20 / 3, 10);
		});

		it("returns the same state reference (mutates in place)", () => {
			const state = createWelfordState();
			const returned = welfordUpdate(state, 42);
			expect(returned).toBe(state);
		});
	});

	describe("welfordVariance and welfordStdDev", () => {
		it("returns 0 for empty state", () => {
			const state = createWelfordState();
			expect(welfordVariance(state)).toBe(0);
			expect(welfordStdDev(state)).toBe(0);
		});

		it("returns 0 for single observation", () => {
			const state = createWelfordState();
			welfordUpdate(state, 42);
			expect(welfordVariance(state)).toBe(0);
			expect(welfordStdDev(state)).toBe(0);
		});

		it("computes variance for identical values as 0", () => {
			const state = createWelfordState();
			for (let i = 0; i < 10; i++) {
				welfordUpdate(state, 5.0);
			}
			expect(welfordVariance(state)).toBe(0);
			expect(welfordStdDev(state)).toBe(0);
		});
	});

	describe("computeSharpeFromWelford", () => {
		it("returns invalid for insufficient samples", () => {
			const state = createWelfordState();
			for (let i = 0; i < 10; i++) {
				welfordUpdate(state, 0.001);
			}
			const result = computeSharpeFromWelford(state);
			expect(result.isValid).toBe(false);
			expect(result.sampleCount).toBe(10);
			expect(Number.isNaN(result.sharpeRatio)).toBe(true);
			expect(result.reason).toContain("30");
		});

		it("returns invalid for zero volatility (constant returns)", () => {
			const state = createWelfordState();
			for (let i = 0; i < MIN_SHARPE_SAMPLES; i++) {
				welfordUpdate(state, 0.001);
			}
			const result = computeSharpeFromWelford(state);
			expect(result.isValid).toBe(false);
			expect(result.reason).toContain("Volatility too low");
		});

		it("computes positive Sharpe for consistently positive returns", () => {
			const state = createWelfordState();
			// Use returns with mean ~0.005 and stddev ~0.03 to keep annualized Sharpe < 100.
			// Sharpe ≈ 0.005/0.03 * sqrt(105120) ≈ 0.167 * 324 ≈ 54
			for (let i = 0; i < 50; i++) {
				// Alternate between positive and negative, biased positive
				welfordUpdate(state, i % 2 === 0 ? 0.04 : -0.03);
			}
			const result = computeSharpeFromWelford(state);
			expect(result.isValid).toBe(true);
			expect(result.sharpeRatio).toBeGreaterThan(0);
			expect(Number.isFinite(result.sharpeRatio)).toBe(true);
		});

		it("computes negative Sharpe for consistently negative returns", () => {
			const state = createWelfordState();
			// Same structure but biased negative
			for (let i = 0; i < 50; i++) {
				welfordUpdate(state, i % 2 === 0 ? -0.04 : 0.03);
			}
			const result = computeSharpeFromWelford(state);
			expect(result.isValid).toBe(true);
			expect(result.sharpeRatio).toBeLessThan(0);
		});

		it("matches hand-calculated Sharpe for known returns", () => {
			// Use returns where annualized Sharpe stays within [-100, 100].
			// Returns with mean ~0.005, stddev ~0.03:
			// Sharpe ≈ 0.005/0.03 * 324 ≈ 54
			const baseReturns = [0.03, 0.02, -0.04, 0.035, -0.025];
			const state = createWelfordState();
			for (let rep = 0; rep < 7; rep++) {
				for (const r of baseReturns) {
					welfordUpdate(state, r);
				}
			}

			// Verify with batch computation
			const allReturns: number[] = [];
			for (let rep = 0; rep < 7; rep++) {
				allReturns.push(...baseReturns);
			}
			const batchMean = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
			const batchVar =
				allReturns.reduce((sum, r) => sum + (r - batchMean) ** 2, 0) /
				(allReturns.length - 1);
			const batchStdDev = Math.sqrt(batchVar);

			expect(state.mean).toBeCloseTo(batchMean, 10);
			expect(welfordStdDev(state)).toBeCloseTo(batchStdDev, 10);

			// Sharpe = mean / stddev * sqrt(annualization_factor)
			const expectedSharpe =
				(batchMean / batchStdDev) * Math.sqrt(ANNUALIZATION_FACTOR);

			// Verify expected Sharpe is within our validity bounds
			expect(Math.abs(expectedSharpe)).toBeLessThan(100);

			const result = computeSharpeFromWelford(state);
			expect(result.isValid).toBe(true);
			expect(result.sharpeRatio).toBeCloseTo(expectedSharpe, 5);
		});

		it("returns full result metadata", () => {
			const state = createWelfordState();
			for (let i = 0; i < 35; i++) {
				welfordUpdate(state, 0.001 * (1 + Math.sin(i)));
			}
			const result = computeSharpeFromWelford(state);
			expect(result.sampleCount).toBe(35);
			expect(result.meanReturn).toBeCloseTo(state.mean, 10);
			expect(result.stdDevReturn).toBeCloseTo(welfordStdDev(state), 10);
		});
	});

	describe("computePeriodReturn", () => {
		it("computes positive return correctly", () => {
			expect(computePeriodReturn(110, 100)).toBeCloseTo(0.1, 10);
		});

		it("computes negative return correctly", () => {
			expect(computePeriodReturn(90, 100)).toBeCloseTo(-0.1, 10);
		});

		it("returns null for zero previous value", () => {
			expect(computePeriodReturn(100, 0)).toBeNull();
		});

		it("returns null for negative previous value", () => {
			expect(computePeriodReturn(100, -50)).toBeNull();
		});

		it("returns null for non-finite values", () => {
			expect(computePeriodReturn(Number.NaN, 100)).toBeNull();
			expect(computePeriodReturn(100, Number.NaN)).toBeNull();
			expect(computePeriodReturn(Number.POSITIVE_INFINITY, 100)).toBeNull();
		});

		it("returns 0 for identical values", () => {
			expect(computePeriodReturn(100, 100)).toBe(0);
		});
	});

	describe("Serialization", () => {
		it("round-trips through serialize/deserialize", () => {
			const state = createWelfordState();
			for (let i = 0; i < 10; i++) {
				welfordUpdate(state, Math.random());
			}

			const serialized = serializeWelfordState(state);
			const deserialized = deserializeWelfordState(serialized);

			expect(deserialized.mean).toBeCloseTo(state.mean, 15);
			expect(deserialized.m2).toBeCloseTo(state.m2, 15);
			expect(deserialized.count).toBe(state.count);
		});

		it("deserializes invalid input to fresh state", () => {
			expect(deserializeWelfordState(null).count).toBe(0);
			expect(deserializeWelfordState(undefined).count).toBe(0);
			expect(deserializeWelfordState("garbage").count).toBe(0);
			expect(deserializeWelfordState({ mean: "bad", m2: 0, count: 0 }).count).toBe(0);
			expect(deserializeWelfordState({ mean: 0, m2: 0, count: -1 }).count).toBe(0);
		});

		it("preserves state across simulated trade cycles", () => {
			// Simulate 3 trade cycles with enough variance for valid annualized Sharpe.
			// Mean ~0.005, stddev ~0.03 → annualized Sharpe ≈ 54 (within [-100, 100])
			let state = createWelfordState();

			// Cycle 1: 12 observations
			for (let i = 0; i < 12; i++) {
				welfordUpdate(state, 0.03 * Math.sin(i) + 0.005);
			}
			let serialized = serializeWelfordState(state);

			// Simulate persistence: deserialize from "storage"
			state = deserializeWelfordState(serialized);
			expect(state.count).toBe(12);

			// Cycle 2: 12 more observations
			for (let i = 0; i < 12; i++) {
				welfordUpdate(state, 0.03 * Math.cos(i) + 0.005);
			}
			serialized = serializeWelfordState(state);

			// Simulate persistence again
			state = deserializeWelfordState(serialized);
			expect(state.count).toBe(24);

			// Cycle 3: 11 more observations (total 35, enough for Sharpe)
			for (let i = 0; i < 11; i++) {
				welfordUpdate(state, 0.03 * Math.sin(i + 2) + 0.005);
			}
			expect(state.count).toBe(35);

			// Now Sharpe should be valid
			const result = computeSharpeFromWelford(state);
			expect(result.isValid).toBe(true);
		});
	});
});
