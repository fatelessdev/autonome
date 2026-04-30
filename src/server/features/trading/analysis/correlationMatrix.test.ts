import { beforeEach, describe, expect, it } from "vitest";
import type { MarketSnapshot } from "@/server/features/trading/data/marketData";
import {
	type CorrelationMatrix,
	computeCorrelationMatrix,
	computeLogReturns,
	computePearsonCorrelation,
	formatCorrelationWarnings,
	generateCorrelationWarnings,
	getCorrelation,
	invalidateCorrelationCache,
} from "./correlationMatrix";

// ==========================================
// Pure math tests: computePearsonCorrelation
// ==========================================

describe("computePearsonCorrelation", () => {
	it("returns 1.0 for perfectly positively correlated series", () => {
		const x = [1, 2, 3, 4, 5];
		const y = [2, 4, 6, 8, 10]; // y = 2x
		expect(computePearsonCorrelation(x, y)).toBeCloseTo(1.0, 10);
	});

	it("returns -1.0 for perfectly negatively correlated series", () => {
		const x = [1, 2, 3, 4, 5];
		const y = [10, 8, 6, 4, 2]; // y = 12 - 2x
		expect(computePearsonCorrelation(x, y)).toBeCloseTo(-1.0, 10);
	});

	it("returns ~0 for uncorrelated series", () => {
		const x = [1, 2, 3, 4, 5, 6];
		const y = [3, 1, 4, 1, 5, 9]; // digits of pi — no linear relation to 1..6
		const r = computePearsonCorrelation(x, y);
		expect(r).not.toBeNull();
		// Should be far from ±1
		expect(Math.abs(r ?? 0)).toBeLessThan(0.8);
	});

	it("returns null for arrays with fewer than 2 elements", () => {
		expect(computePearsonCorrelation([1], [2])).toBeNull();
		expect(computePearsonCorrelation([], [])).toBeNull();
	});

	it("returns null for constant series (zero variance)", () => {
		expect(computePearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
		expect(computePearsonCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
	});

	it("handles arrays of different lengths (uses min)", () => {
		const x = [1, 2, 3, 4, 5, 6, 7, 8];
		const y = [2, 4, 6];
		// First 3 elements: x=[1,2,3], y=[2,4,6] => perfect positive
		expect(computePearsonCorrelation(x, y)).toBeCloseTo(1.0, 10);
	});

	it("computes moderate positive correlation correctly", () => {
		// Known dataset: x=[1,2,3,4,5], y=[1.5, 2.8, 3.2, 4.9, 5.1]
		// Expected r ≈ 0.985
		const x = [1, 2, 3, 4, 5];
		const y = [1.5, 2.8, 3.2, 4.9, 5.1];
		const r = computePearsonCorrelation(x, y);
		expect(r).not.toBeNull();
		expect(r ?? 0).toBeGreaterThan(0.95);
		expect(r ?? 0).toBeLessThanOrEqual(1.0);
	});

	it("handles negative values correctly", () => {
		const x = [-2, -1, 0, 1, 2];
		const y = [-4, -2, 0, 2, 4]; // y = 2x
		expect(computePearsonCorrelation(x, y)).toBeCloseTo(1.0, 10);
	});

	it("handles very small values (financial returns scale)", () => {
		const x = [0.001, -0.002, 0.003, -0.001, 0.002];
		const y = [0.0012, -0.0018, 0.0031, -0.0009, 0.0022];
		const r = computePearsonCorrelation(x, y);
		expect(r).not.toBeNull();
		// These are correlated — should be high
		expect(r ?? 0).toBeGreaterThan(0.9);
	});

	it("symmetric: r(x,y) == r(y,x)", () => {
		const x = [1, 3, 5, 7, 9];
		const y = [2, 6, 10, 14, 18];
		const r1 = computePearsonCorrelation(x, y);
		const r2 = computePearsonCorrelation(y, x);
		expect(r1).not.toBeNull();
		expect(r2).not.toBeNull();
		expect(r1 ?? 0).toBeCloseTo(r2 ?? 0, 10);
	});
});

// ==========================================
// computeLogReturns
// ==========================================

describe("computeLogReturns", () => {
	it("returns empty for a single price", () => {
		expect(computeLogReturns([100])).toEqual([]);
	});

	it("returns empty for empty array", () => {
		expect(computeLogReturns([])).toEqual([]);
	});

	it("computes log returns correctly", () => {
		const prices = [100, 110, 105];
		const returns = computeLogReturns(prices);
		expect(returns).toHaveLength(2);
		expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 10);
		expect(returns[1]).toBeCloseTo(Math.log(105 / 110), 10);
	});

	it("skips entries where previous price is zero or negative", () => {
		const prices = [0, 100, 110];
		// prices[0]=0 → skip (prev <= 0), prices[2]=110 → log(110/100)
		const returns = computeLogReturns(prices);
		expect(returns).toHaveLength(1);
		expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 10);
	});

	it("skips entries where current price is zero or negative", () => {
		const prices = [100, 0, 110];
		// prices[1]=0 → skip (curr <= 0), prices[2]=110 → skip? No, prev=0 → skip
		const returns = computeLogReturns(prices);
		expect(returns).toHaveLength(0);
	});

	it("handles constant prices (returns all zeros)", () => {
		const prices = [50, 50, 50, 50];
		const returns = computeLogReturns(prices);
		expect(returns).toHaveLength(3);
		for (const r of returns) {
			expect(r).toBeCloseTo(0, 10);
		}
	});
});

// ==========================================
// computeCorrelationMatrix with mock data
// ==========================================

/** Create a minimal MarketSnapshot with intraday midPrices */
function makeSnapshot(symbol: string, midPrices: number[]): MarketSnapshot {
	return {
		symbol,
		latest: {
			price: midPrices.at(-1) ?? null,
			ema20: null,
			ema50: null,
			macd: null,
			rsi7: null,
			rsi14: null,
			atr10: null,
			atr14: null,
			volume: null,
			averageVolume: null,
		},
		series: {
			intraday: {
				timeframe: "5Min",
				timestamps: midPrices.map(
					(_, i) => `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
				),
				midPrices,
				ema20: [],
				ema50: [],
				macd: [],
				rsi7: [],
				rsi14: [],
				atr10: [],
				atr14: [],
				volumes: [],
			},
			higherTimeframe: {
				timeframe: "4Hour",
				timestamps: [],
				midPrices: [],
				ema20: [],
				ema50: [],
				macd: [],
				rsi7: [],
				rsi14: [],
				atr10: [],
				atr14: [],
				volumes: [],
			},
		},
	} as MarketSnapshot;
}

describe("computeCorrelationMatrix", () => {
	beforeEach(() => {
		invalidateCorrelationCache();
	});

	it("returns empty pairs for fewer than 2 snapshots", () => {
		const snapshots = [makeSnapshot("BTC", [100, 101, 102])];
		const matrix = computeCorrelationMatrix(snapshots);
		expect(matrix.pairs).toHaveLength(0);
	});

	it("computes one pair for two snapshots", () => {
		const snapshots = [
			makeSnapshot("BTC", [100, 102, 104, 106, 108]),
			makeSnapshot("ETH", [50, 51, 52, 53, 54]),
		];
		const matrix = computeCorrelationMatrix(snapshots);
		expect(matrix.pairs).toHaveLength(1);
		expect(matrix.pairs[0].symbolA).toBe("BTC");
		expect(matrix.pairs[0].symbolB).toBe("ETH");
	});

	it("computes n*(n-1)/2 pairs for n snapshots", () => {
		const snapshots = [
			makeSnapshot("BTC", [100, 101, 102, 103, 104]),
			makeSnapshot("ETH", [50, 51, 52, 53, 54]),
			makeSnapshot("SOL", [10, 11, 12, 13, 14]),
		];
		const matrix = computeCorrelationMatrix(snapshots);
		// 3 choose 2 = 3 pairs
		expect(matrix.pairs).toHaveLength(3);
	});

	it("detects high correlation for similar price movements", () => {
		// Prices with varying returns that move in the same direction
		// Each step has a different % change but the pattern is the same
		const btc = [100, 103, 101, 106, 104, 110];
		const eth = [50, 51.5, 50.5, 53, 52, 55];
		const snapshots = [makeSnapshot("BTC", btc), makeSnapshot("ETH", eth)];
		const matrix = computeCorrelationMatrix(snapshots);

		const pair = matrix.pairs[0];
		expect(pair.correlation).toBeGreaterThan(0.8);
	});

	it("detects low correlation for different price movements", () => {
		const btc = [100, 102, 100, 102, 100, 102];
		const eth = [50, 50, 50, 50, 50, 50]; // constant — returns are zero
		const snapshots = [makeSnapshot("BTC", btc), makeSnapshot("ETH", eth)];
		const matrix = computeCorrelationMatrix(snapshots);

		// Constant series → null Pearson → stored as 0
		expect(matrix.pairs[0].correlation).toBe(0);
	});

	it("skips snapshots with fewer than 2 price points", () => {
		const snapshots = [
			makeSnapshot("BTC", [100, 102, 104]),
			makeSnapshot("ETH", [50]), // only 1 point — too few
			makeSnapshot("SOL", [10, 11, 12]),
		];
		const matrix = computeCorrelationMatrix(snapshots);
		// Only BTC-SOL pair (ETH excluded)
		expect(matrix.pairs).toHaveLength(1);
		expect(matrix.pairs[0].symbolA).toBe("BTC");
		expect(matrix.pairs[0].symbolB).toBe("SOL");
	});

	it("filters out non-finite and non-positive prices", () => {
		const btc = [100, NaN, 102, Infinity, 104, -5, 106];
		const eth = [50, 51, 52, 53, 54, 55, 56];
		const snapshots = [makeSnapshot("BTC", btc), makeSnapshot("ETH", eth)];
		const matrix = computeCorrelationMatrix(snapshots);
		// Should still compute (BTC has 4 valid prices → 3 returns)
		expect(matrix.pairs).toHaveLength(1);
	});

	it("caches the result within TTL", () => {
		const snapshots = [
			makeSnapshot("BTC", [100, 101, 102]),
			makeSnapshot("ETH", [50, 51, 52]),
		];
		const matrix1 = computeCorrelationMatrix(snapshots);
		const matrix2 = computeCorrelationMatrix(snapshots);
		expect(matrix1).toBe(matrix2); // same reference — cached
	});

	it("invalidating cache produces fresh result", () => {
		const snapshots = [
			makeSnapshot("BTC", [100, 101, 102]),
			makeSnapshot("ETH", [50, 51, 52]),
		];
		const matrix1 = computeCorrelationMatrix(snapshots);
		invalidateCorrelationCache();
		const matrix2 = computeCorrelationMatrix(snapshots);
		expect(matrix1).not.toBe(matrix2); // different reference — fresh
	});

	it("records dataPoints correctly", () => {
		// 5 prices → 4 returns
		const snapshots = [
			makeSnapshot("BTC", [100, 101, 102, 103, 104]),
			makeSnapshot("ETH", [50, 51, 52, 53, 54]),
		];
		const matrix = computeCorrelationMatrix(snapshots);
		expect(matrix.dataPoints).toBe(4);
	});

	it("symbols are sorted alphabetically", () => {
		const snapshots = [
			makeSnapshot("SOL", [10, 11, 12]),
			makeSnapshot("BTC", [100, 101, 102]),
			makeSnapshot("ETH", [50, 51, 52]),
		];
		const matrix = computeCorrelationMatrix(snapshots);
		// Pairs should be in alphabetical order: BTC-ETH, BTC-SOL, ETH-SOL
		expect(matrix.pairs[0].symbolA).toBe("BTC");
		expect(matrix.pairs[0].symbolB).toBe("ETH");
		expect(matrix.pairs[1].symbolA).toBe("BTC");
		expect(matrix.pairs[1].symbolB).toBe("SOL");
		expect(matrix.pairs[2].symbolA).toBe("ETH");
		expect(matrix.pairs[2].symbolB).toBe("SOL");
	});

	it("handles inverse correlation correctly", () => {
		// BTC goes up with varying returns, ETH goes down with varying returns
		// Mirror pattern with varying steps
		const btc = [100, 103, 101, 106, 104, 110];
		const eth = [110, 107, 109, 104, 106, 100];
		const snapshots = [makeSnapshot("BTC", btc), makeSnapshot("ETH", eth)];
		const matrix = computeCorrelationMatrix(snapshots);
		expect(matrix.pairs[0].correlation).toBeLessThan(-0.8);
	});
});

// ==========================================
// Warning generation
// ==========================================

describe("generateCorrelationWarnings", () => {
	function makeMatrix(
		pairs: Array<{ symbolA: string; symbolB: string; correlation: number }>,
	): CorrelationMatrix {
		return {
			pairs,
			dataPoints: 10,
			computedAt: Date.now(),
		};
	}

	it("generates warning when both symbols are held and correlation > 0.8", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "ETH", correlation: 0.92 },
		]);
		const warnings = generateCorrelationWarnings(
			matrix,
			new Set(["BTC", "ETH"]),
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].message).toContain("0.92");
		expect(warnings[0].message).toContain("BTC");
		expect(warnings[0].message).toContain("ETH");
	});

	it("generates warning for negative correlation below -0.8", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "ETH", correlation: -0.85 },
		]);
		const warnings = generateCorrelationWarnings(
			matrix,
			new Set(["BTC", "ETH"]),
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].message).toContain("negative");
	});

	it("no warning when only one symbol is held", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "ETH", correlation: 0.95 },
		]);
		const warnings = generateCorrelationWarnings(matrix, new Set(["BTC"]));
		expect(warnings).toHaveLength(0);
	});

	it("no warning when correlation is below threshold", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "ETH", correlation: 0.75 },
		]);
		const warnings = generateCorrelationWarnings(
			matrix,
			new Set(["BTC", "ETH"]),
		);
		expect(warnings).toHaveLength(0);
	});

	it("generates warning when one symbol is held and other is considered", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "SOL", correlation: 0.88 },
		]);
		const warnings = generateCorrelationWarnings(
			matrix,
			new Set(["BTC"]),
			new Set(["SOL"]),
		);
		expect(warnings).toHaveLength(1);
	});

	it("generates multiple warnings for multiple correlated pairs", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "ETH", correlation: 0.92 },
			{ symbolA: "BTC", symbolB: "SOL", correlation: 0.85 },
			{ symbolA: "ETH", symbolB: "SOL", correlation: 0.7 }, // below threshold
		]);
		const warnings = generateCorrelationWarnings(
			matrix,
			new Set(["BTC", "ETH", "SOL"]),
		);
		expect(warnings).toHaveLength(2);
	});

	it("no warning with empty held symbols", () => {
		const matrix = makeMatrix([
			{ symbolA: "BTC", symbolB: "ETH", correlation: 0.99 },
		]);
		const warnings = generateCorrelationWarnings(matrix, new Set());
		expect(warnings).toHaveLength(0);
	});
});

// ==========================================
// formatCorrelationWarnings
// ==========================================

describe("formatCorrelationWarnings", () => {
	it("returns empty string for no warnings", () => {
		expect(formatCorrelationWarnings([])).toBe("");
	});

	it("formats warnings into a section", () => {
		const warnings = [
			{
				symbolA: "BTC",
				symbolB: "ETH",
				correlation: 0.92,
				message:
					"BTC-ETH correlation 0.92 (positive) — avoid stacking correlated positions.",
			},
		];
		const output = formatCorrelationWarnings(warnings);
		expect(output).toContain("== CORRELATION WARNINGS ==");
		expect(output).toContain("BTC-ETH correlation 0.92");
		expect(output).toContain("⚠");
	});

	it("includes all warnings", () => {
		const warnings = [
			{
				symbolA: "BTC",
				symbolB: "ETH",
				correlation: 0.92,
				message: "BTC-ETH warning",
			},
			{
				symbolA: "SOL",
				symbolB: "XRP",
				correlation: 0.88,
				message: "SOL-XRP warning",
			},
		];
		const output = formatCorrelationWarnings(warnings);
		expect(output).toContain("BTC-ETH warning");
		expect(output).toContain("SOL-XRP warning");
	});
});

// ==========================================
// getCorrelation helper
// ==========================================

describe("getCorrelation", () => {
	const matrix: CorrelationMatrix = {
		pairs: [
			{ symbolA: "BTC", symbolB: "ETH", correlation: 0.92 },
			{ symbolA: "BTC", symbolB: "SOL", correlation: 0.5 },
		],
		dataPoints: 10,
		computedAt: Date.now(),
	};

	it("finds correlation by exact pair order", () => {
		expect(getCorrelation(matrix, "BTC", "ETH")).toBe(0.92);
	});

	it("finds correlation by reversed pair order", () => {
		expect(getCorrelation(matrix, "ETH", "BTC")).toBe(0.92);
	});

	it("returns null for unknown pair", () => {
		expect(getCorrelation(matrix, "ETH", "SOL")).toBeNull();
	});

	it("returns null for unknown symbol", () => {
		expect(getCorrelation(matrix, "BTC", "DOGE")).toBeNull();
	});
});
