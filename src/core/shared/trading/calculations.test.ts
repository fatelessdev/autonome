import { describe, it, expect } from "vitest";
import {
	toFiniteNumber,
	requireFiniteNumber,
	requirePresent,
	calculateUnrealizedPnl,
	calculateTotalPnl,
	calculateWinRate,
	calculateMaxDrawdown,
	calculateMaxDrawdownAbsolute,
	calculateCurrentDrawdown,
	mean,
	standardDeviation,
	median,
	calculateSharpeRatioFromPortfolio,
	calculateSharpeRatioFromTrades,
	calculateReturnPercent,
	calculateHoldTimeMinutes,
	formatHoldTime,
	calculateTradeSize,
	calculateExpectancy,
	calculateRecoveryFactor,
	calculateRecoveryFactorFromPnls,
} from "./calculations";

describe("calculations", () => {
	describe("toFiniteNumber", () => {
		it("returns finite numbers as-is", () => {
			expect(toFiniteNumber(42)).toBe(42);
			expect(toFiniteNumber(0)).toBe(0);
			expect(toFiniteNumber(-3.14)).toBe(-3.14);
		});

		it("parses numeric strings", () => {
			expect(toFiniteNumber("123")).toBe(123);
			expect(toFiniteNumber("3.14")).toBe(3.14);
			expect(toFiniteNumber("-5")).toBe(-5);
		});

		it("returns null for non-finite numbers", () => {
			expect(toFiniteNumber(Number.NaN)).toBeNull();
			expect(toFiniteNumber(Infinity)).toBeNull();
			expect(toFiniteNumber(-Infinity)).toBeNull();
		});

		it("returns null for null, undefined, empty string", () => {
			expect(toFiniteNumber(null)).toBeNull();
			expect(toFiniteNumber(undefined)).toBeNull();
			expect(toFiniteNumber("")).toBeNull();
		});

		it("returns null for non-numeric strings", () => {
			expect(toFiniteNumber("abc")).toBeNull();
		});

		it("returns null for other types", () => {
			expect(toFiniteNumber(true)).toBeNull();
			expect(toFiniteNumber({})).toBeNull();
			expect(toFiniteNumber([])).toBeNull();
		});
	});

	describe("requireFiniteNumber", () => {
		it("returns the number when finite", () => {
			expect(requireFiniteNumber(42, "test")).toBe(42);
			expect(requireFiniteNumber("3.14", "test")).toBe(3.14);
		});

		it("throws for non-finite values", () => {
			expect(() => requireFiniteNumber(NaN, "price")).toThrow(
				"Invalid numeric value for price",
			);
			expect(() => requireFiniteNumber(null, "qty")).toThrow();
			expect(() => requireFiniteNumber("abc", "amount")).toThrow();
		});
	});

	describe("requirePresent", () => {
		it("returns value when present", () => {
			expect(requirePresent(42, "test")).toBe(42);
			expect(requirePresent("hello", "test")).toBe("hello");
			expect(requirePresent(0, "test")).toBe(0);
			expect(requirePresent(false, "test")).toBe(false);
		});

		it("throws for null/undefined", () => {
			expect(() => requirePresent(null, "field")).toThrow(
				"Missing required value for field",
			);
			expect(() => requirePresent(undefined, "field")).toThrow();
		});
	});

	describe("calculateUnrealizedPnl", () => {
		it("calculates P&L for a LONG position", () => {
			const position = { quantity: 10, notional: "1000", side: "LONG" as const };
			expect(calculateUnrealizedPnl(position, 110)).toBe(100); // (110 - 100) * 10
		});

		it("calculates P&L for a SHORT position", () => {
			const position = { quantity: 10, notional: "1000", side: "SHORT" as const };
			expect(calculateUnrealizedPnl(position, 90)).toBe(100); // (100 - 90) * 10
		});

		it("falls back to stored unrealizedPnl when currentPrice is null", () => {
			const position = { unrealizedPnl: 50 };
			expect(calculateUnrealizedPnl(position, null)).toBe(50);
		});

		it("falls back to 0 when no market data available", () => {
			expect(calculateUnrealizedPnl({}, null)).toBe(0);
		});
	});

	describe("calculateTotalPnl", () => {
		it("sums P&L values", () => {
			expect(calculateTotalPnl([100, -50, 200])).toBe(250);
		});

		it("returns 0 for empty array", () => {
			expect(calculateTotalPnl([])).toBe(0);
		});
	});

	describe("calculateWinRate", () => {
		it("calculates win rate as percentage", () => {
			expect(calculateWinRate([100, -50, 200, -10])).toBe(50); // 2/4 wins
		});

		it("returns 100% when all wins", () => {
			expect(calculateWinRate([10, 20, 30])).toBe(100);
		});

		it("returns 0% when all losses", () => {
			expect(calculateWinRate([-10, -20])).toBe(0);
		});

		it("returns 0 for empty array", () => {
			expect(calculateWinRate([])).toBe(0);
		});
	});

	describe("calculateMaxDrawdown", () => {
		it("calculates max drawdown as positive percentage", () => {
			const values = [100, 120, 90, 110, 80];
			// peak=120, trough=80, dd = (120-80)/120*100 = 33.33
			expect(calculateMaxDrawdown(values)).toBeCloseTo(33.33, 1);
		});

		it("returns 0 for monotonically increasing series", () => {
			expect(calculateMaxDrawdown([100, 110, 120, 130])).toBe(0);
		});

		it("returns 0 for empty array", () => {
			expect(calculateMaxDrawdown([])).toBe(0);
		});
	});

	describe("calculateMaxDrawdownAbsolute", () => {
		it("calculates max drawdown in absolute currency", () => {
			const values = [100, 120, 90, 110, 80];
			// peak=120, trough=80, ddAbs = 120-80 = 40
			expect(calculateMaxDrawdownAbsolute(values)).toBe(40);
		});

		it("returns 0 for empty array", () => {
			expect(calculateMaxDrawdownAbsolute([])).toBe(0);
		});
	});

	describe("calculateCurrentDrawdown", () => {
		it("calculates current drawdown from peak", () => {
			const values = [100, 120, 110];
			// peak=120, current=110, dd = (120-110)/120*100 = 8.33
			expect(calculateCurrentDrawdown(values)).toBeCloseTo(8.33, 1);
		});

		it("returns 0 when at peak", () => {
			expect(calculateCurrentDrawdown([100, 120])).toBe(0);
		});

		it("returns 0 for empty array", () => {
			expect(calculateCurrentDrawdown([])).toBe(0);
		});
	});

	describe("mean", () => {
		it("calculates arithmetic mean", () => {
			expect(mean([10, 20, 30])).toBe(20);
		});

		it("returns 0 for empty array", () => {
			expect(mean([])).toBe(0);
		});

		it("handles single value", () => {
			expect(mean([42])).toBe(42);
		});
	});

	describe("standardDeviation", () => {
		it("calculates population standard deviation", () => {
			// [2, 4, 4, 4, 5, 5, 7, 9] -> mean=5, variance=4, stddev=2
			const result = standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
			expect(result).toBeCloseTo(2.0, 1);
		});

		it("returns 0 for single value", () => {
			expect(standardDeviation([42])).toBe(0);
		});

		it("returns 0 for empty array", () => {
			expect(standardDeviation([])).toBe(0);
		});
	});

	describe("median", () => {
		it("returns middle value for odd-length sorted array", () => {
			expect(median([1, 3, 5])).toBe(3);
		});

		it("returns average of two middle values for even-length sorted array", () => {
			expect(median([1, 3, 5, 7])).toBe(4);
		});

		it("returns 0 for empty array", () => {
			expect(median([])).toBe(0);
		});

		it("returns single value for length-1 array", () => {
			expect(median([42])).toBe(42);
		});
	});

	describe("calculateSharpeRatioFromPortfolio", () => {
		it("returns invalid for <2 data points", () => {
			const result = calculateSharpeRatioFromPortfolio([100]);
			expect(result.isValid).toBe(false);
			expect(result.reason).toBe("Insufficient data points");
		});

		it("returns invalid for <30 data points", () => {
			const values = Array.from({ length: 20 }, (_, i) => 100 + i);
			const result = calculateSharpeRatioFromPortfolio(values);
			expect(result.isValid).toBe(false);
			expect(result.reason).toBe("Need at least 30 observations");
		});

		it("calculates sharpe for sufficient data", () => {
			// Generate a series with positive drift
			const values = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
			const result = calculateSharpeRatioFromPortfolio(values, 1);
			expect(result.isValid).toBe(true);
			expect(typeof result.sharpeRatio).toBe("number");
		});

		it("returns invalid for constant values (zero volatility)", () => {
			const values = Array(60).fill(100);
			const result = calculateSharpeRatioFromPortfolio(values);
			expect(result.isValid).toBe(false);
			expect(result.reason).toBe("Volatility too low for meaningful Sharpe");
		});
	});

	describe("calculateSharpeRatioFromTrades", () => {
		it("calculates simple Sharpe from P&Ls", () => {
			const pnls = [10, 20, -5, 15, 8];
			const result = calculateSharpeRatioFromTrades(pnls);
			// mean = 9.6, stdDev ~= 8.58, sharpe ~= 1.119
			expect(result).toBeGreaterThan(1);
		});

		it("returns 0 for <2 P&Ls", () => {
			expect(calculateSharpeRatioFromTrades([10])).toBe(0);
			expect(calculateSharpeRatioFromTrades([])).toBe(0);
		});

		it("returns 0 for zero volatility", () => {
			expect(calculateSharpeRatioFromTrades([5, 5, 5])).toBe(0);
		});
	});

	describe("calculateReturnPercent", () => {
		it("calculates return percentage", () => {
			expect(calculateReturnPercent(110_000, 100_000)).toBe(10);
			expect(calculateReturnPercent(90_000, 100_000)).toBe(-10);
		});

		it("uses default INITIAL_CAPITAL", () => {
			expect(calculateReturnPercent(110_000)).toBeCloseTo(10);
		});

		it("returns 0 when initial is 0", () => {
			expect(calculateReturnPercent(100, 0)).toBe(0);
		});
	});

	describe("calculateHoldTimeMinutes", () => {
		it("calculates hold time in minutes", () => {
			const opened = new Date("2024-01-01T10:00:00Z");
			const closed = new Date("2024-01-01T12:30:00Z");
			expect(calculateHoldTimeMinutes(opened, closed)).toBe(150);
		});

		it("returns 0 when closed before opened", () => {
			const opened = new Date("2024-01-01T12:00:00Z");
			const closed = new Date("2024-01-01T10:00:00Z");
			expect(calculateHoldTimeMinutes(opened, closed)).toBe(0);
		});
	});

	describe("formatHoldTime", () => {
		it("formats minutes", () => {
			expect(formatHoldTime(45)).toBe("45m");
		});

		it("formats hours", () => {
			expect(formatHoldTime(90)).toBe("1.5h");
		});

		it("formats days", () => {
			expect(formatHoldTime(2880)).toBe("2.0d");
		});
	});

	describe("calculateTradeSize", () => {
		it("calculates notional value", () => {
			expect(calculateTradeSize(10, 100)).toBe(1000);
		});

		it("uses absolute values", () => {
			expect(calculateTradeSize(-10, 100)).toBe(1000);
		});
	});

	describe("calculateExpectancy", () => {
		it("calculates expectancy from P&Ls", () => {
			const pnls = [100, -50, 200, -100];
			// wins=[100,200], losses=[50,100], winPct=0.5, lossPct=0.5
			// expect = 0.5*150 - 0.5*75 = 37.5
			expect(calculateExpectancy(pnls)).toBeCloseTo(37.5, 0);
		});

		it("returns 0 for empty array", () => {
			expect(calculateExpectancy([])).toBe(0);
		});

		it("handles all wins", () => {
			expect(calculateExpectancy([10, 20])).toBeCloseTo(15);
		});

		it("handles all losses", () => {
			expect(calculateExpectancy([-10, -20])).toBeCloseTo(-15);
		});
	});

	describe("calculateRecoveryFactor", () => {
		it("calculates recovery factor from equity curve", () => {
			const values = [100, 110, 90, 120];
			// net profit = 120 - 100 = 20
			// max dd abs = 110 - 90 = 20
			// recovery = 20 / 20 = 1
			expect(calculateRecoveryFactor(values)).toBeCloseTo(1, 1);
		});

		it("returns 0 for <2 data points", () => {
			expect(calculateRecoveryFactor([100])).toBe(0);
		});

		it("returns 0 when no drawdown", () => {
			expect(calculateRecoveryFactor([100, 110, 120])).toBe(0);
		});
	});

	describe("calculateRecoveryFactorFromPnls", () => {
		it("calculates recovery factor from trade P&Ls", () => {
			const pnls = [50, -30, 60, -20, 40];
			// equity curve: [0, 50, 20, 80, 60, 100]
			// net profit = 100 - 0 = 100
			// max dd abs = 50 - 20 = 30 (peak at index 1, trough at index 2)
			// recovery = 100 / 30 ≈ 3.33
			expect(calculateRecoveryFactorFromPnls(pnls)).toBeCloseTo(100 / 30, 1);
		});

		it("returns 0 for empty array", () => {
			expect(calculateRecoveryFactorFromPnls([])).toBe(0);
		});
	});
});
