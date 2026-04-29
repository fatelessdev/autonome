import { describe, expect, it } from "vitest";
import {
	type Candlestick,
	getAtr,
	getCloses,
	getEma,
	getMacd,
	getMidPrices,
	getRsi,
	getRollingAverage,
	getRollingStdDev,
	getSma,
	roundSeries,
	roundValue,
	toPercent,
} from "./technicalIndicators";

describe("technicalIndicators", () => {
	describe("getEma", () => {
		it("should return empty array when prices length < period", () => {
			expect(getEma([1, 2], 3)).toEqual([]);
		});

		it("should calculate EMA for exact period length", () => {
			// SMA of first 3 values = (10 + 20 + 30) / 3 = 20
			const result = getEma([10, 20, 30], 3);
			expect(result).toHaveLength(1);
			expect(result[0]).toBe(20);
		});

		it("should calculate EMA with smoothing", () => {
			const prices = [10, 20, 30, 40, 50];
			const result = getEma(prices, 3);
			expect(result).toHaveLength(3);
			// First value is SMA: 20
			expect(result[0]).toBe(20);
			// EMA multiplier = 2/(3+1) = 0.5
			// EMA[1] = 20 * 0.5 + 40 * 0.5 = 30
			expect(result[1]).toBeCloseTo(30, 5);
		});

		it("should throw for invalid period", () => {
			expect(() => getEma([1, 2, 3], 0)).toThrow("positive integer");
			expect(() => getEma([1, 2, 3], -1)).toThrow("positive integer");
		});
	});

	describe("getSma", () => {
		it("should return empty when insufficient data", () => {
			expect(getSma([1, 2], 3)).toEqual([]);
		});

		it("should calculate simple moving average", () => {
			const result = getSma([10, 20, 30, 40, 50], 3);
			expect(result).toHaveLength(3);
			expect(result[0]).toBeCloseTo(20, 5);
			expect(result[1]).toBeCloseTo(30, 5);
			expect(result[2]).toBeCloseTo(40, 5);
		});

		it("should handle period of 1", () => {
			expect(getSma([5, 10, 15], 1)).toEqual([5, 10, 15]);
		});
	});

	describe("getMidPrices", () => {
		it("should calculate mid prices from candlesticks", () => {
			const candles: Candlestick[] = [
				{ timestamp: 1, open: 10, high: 15, low: 8, close: 12 },
				{ timestamp: 2, open: 20, high: 25, low: 18, close: 22 },
			];
			expect(getMidPrices(candles)).toEqual([11, 21]);
		});
	});

	describe("getCloses", () => {
		it("should extract close prices", () => {
			const candles: Candlestick[] = [
				{ timestamp: 1, open: 10, high: 15, low: 8, close: 12 },
				{ timestamp: 2, open: 20, high: 25, low: 18, close: 22 },
			];
			expect(getCloses(candles)).toEqual([12, 22]);
		});
	});

	describe("getRsi", () => {
		it("should return empty for insufficient data", () => {
			expect(getRsi([1, 2, 3], 14)).toEqual([]);
		});

		it("should return 100 for all gains", () => {
			const prices = Array.from({ length: 16 }, (_, i) => 100 + i * 10);
			const result = getRsi(prices, 14);
			expect(result.length).toBeGreaterThan(0);
			expect(result[0]).toBeCloseTo(100, 0);
		});

		it("should return 0 for all losses", () => {
			const prices = Array.from({ length: 16 }, (_, i) => 1000 - i * 10);
			const result = getRsi(prices, 14);
			expect(result.length).toBeGreaterThan(0);
			expect(result[0]).toBeCloseTo(0, 0);
		});

		it("should return 50 for flat prices", () => {
			const prices = Array(16).fill(100);
			const result = getRsi(prices, 14);
			expect(result[0]).toBe(50);
		});
	});

	describe("getMacd", () => {
		it("should return MACD line (EMA12 - EMA26)", () => {
			// Need at least 26 prices
			const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.2) * 10);
			const macd = getMacd(prices);
			expect(macd.length).toBeGreaterThan(0);
			// Each value should be a finite number
			for (const val of macd) {
				expect(Number.isFinite(val)).toBe(true);
			}
		});
	});

	describe("getAtr", () => {
		it("should return empty for insufficient data", () => {
			const candles: Candlestick[] = [
				{ timestamp: 1, open: 10, high: 12, low: 9, close: 11 },
			];
			expect(getAtr(candles, 14)).toEqual([]);
		});

		it("should calculate ATR for sufficient data", () => {
			const candles: Candlestick[] = Array.from({ length: 20 }, (_, i) => ({
				timestamp: i,
				open: 100 + i,
				high: 105 + i,
				low: 95 + i,
				close: 102 + i,
			}));
			const atr = getAtr(candles, 5);
			expect(atr.length).toBeGreaterThan(0);
			expect(atr[0]).toBeGreaterThan(0);
		});
	});

	describe("getRollingAverage", () => {
		it("should return empty for insufficient data", () => {
			expect(getRollingAverage([1, 2], 3)).toEqual([]);
		});

		it("should calculate rolling average", () => {
			const result = getRollingAverage([10, 20, 30, 40, 50], 3);
			expect(result).toEqual([20, 30, 40]);
		});
	});

	describe("getRollingStdDev", () => {
		it("should return empty for insufficient data", () => {
			expect(getRollingStdDev([1, 2], 3)).toEqual([]);
		});

		it("should return 0 for constant values", () => {
			const result = getRollingStdDev([5, 5, 5, 5, 5], 3);
			expect(result).toEqual([0, 0, 0]);
		});

		it("should calculate rolling standard deviation", () => {
			const result = getRollingStdDev([2, 4, 4, 4, 5, 5, 7, 9], 3);
			expect(result.length).toBeGreaterThan(0);
			for (const val of result) {
				expect(val).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("roundSeries", () => {
		it("should round values to specified digits", () => {
			expect(roundSeries([1.234, 5.678], 2)).toEqual([1.23, 5.68]);
		});

		it("should default to 3 digits", () => {
			expect(roundSeries([1.23456])).toEqual([1.235]);
		});
	});

	describe("roundValue", () => {
		it("should round valid numbers", () => {
			expect(roundValue(3.14159, 2)).toBe(3.14);
		});

		it("should return null for null/undefined", () => {
			expect(roundValue(null)).toBeNull();
			expect(roundValue(undefined)).toBeNull();
		});

		it("should return null for non-finite", () => {
			expect(roundValue(Number.NaN)).toBeNull();
			expect(roundValue(Number.POSITIVE_INFINITY)).toBeNull();
		});
	});

	describe("toPercent", () => {
		it("should convert ratio to percentage", () => {
			expect(toPercent(0.5, 1)).toBe(50);
			expect(toPercent(0.12345, 2)).toBe(12.35);
		});

		it("should return null for null/undefined", () => {
			expect(toPercent(null)).toBeNull();
			expect(toPercent(undefined)).toBeNull();
		});

		it("should return null for non-finite", () => {
			expect(toPercent(Number.NaN)).toBeNull();
		});
	});
});
