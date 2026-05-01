import { describe, expect, it } from "vitest";
import {
	calculateAdvancedStats,
	calculateCalmarRatio,
	calculateDecisionQualityScore,
	calculateDurationDistribution,
	calculateModelAnalytics,
	calculateOverallStats,
	calculateProfitFactor,
	calculateRMultiple,
	calculateSortinoRatio,
	calculateStreaks,
	INITIAL_CAPITAL,
} from "./calculations";
import type { ClosedTradeData } from "./types";

const makeTrade = (
	overrides: Partial<ClosedTradeData> = {},
): ClosedTradeData => ({
	modelId: "model-1",
	symbol: "BTC",
	side: "LONG",
	quantity: 0.1,
	entryPrice: 50000,
	exitPrice: 51000,
	realizedPnl: 100,
	confidence: 75,
	openedAt: new Date("2025-01-01T00:00:00Z"),
	closedAt: new Date("2025-01-01T01:00:00Z"),
	...overrides,
});

describe("calculations", () => {
	describe("INITIAL_CAPITAL", () => {
		it("is 100,000", () => {
			expect(INITIAL_CAPITAL).toBe(100_000);
		});
	});

	describe("calculateOverallStats", () => {
		it("returns zeroed stats when no trades", () => {
			const stats = calculateOverallStats("m1", "Model", [], 100000);
			expect(stats.tradesCount).toBe(0);
			expect(stats.totalPnl).toBe(0);
			expect(stats.winRate).toBe(0);
			expect(stats.biggestWin).toBe(0);
			expect(stats.biggestLoss).toBe(0);
		});

		it("calculates stats with trades", () => {
			const trades = [
				makeTrade({ realizedPnl: 100 }),
				makeTrade({ realizedPnl: -50 }),
				makeTrade({ realizedPnl: 200 }),
			];

			const stats = calculateOverallStats("m1", "Model", trades, 100300);
			expect(stats.tradesCount).toBe(3);
			expect(stats.totalPnl).toBe(250);
			expect(stats.winRate).toBeCloseTo(66.67, 1);
			expect(stats.biggestWin).toBe(200);
			expect(stats.biggestLoss).toBe(-50);
		});

		it("includes variant when provided", () => {
			const stats = calculateOverallStats(
				"m1",
				"Model",
				[],
				100000,
				"Trendsurfer",
			);
			expect(stats.variant).toBe("Trendsurfer");
		});

		it("calculates return percent correctly", () => {
			const stats = calculateOverallStats("m1", "Model", [], 110000);
			expect(stats.returnPercent).toBeCloseTo(10);
		});
	});

	describe("calculateAdvancedStats", () => {
		it("returns zeroed stats when no trades", () => {
			const stats = calculateAdvancedStats("m1", "Model", [], 100000);
			expect(stats.avgTradeSize).toBe(0);
			expect(stats.avgHoldTimeMinutes).toBe(0);
			expect(stats.longPercent).toBe(0);
			expect(stats.expectancy).toBe(0);
			expect(stats.recoveryFactor).toBe(0);
		});

		it("calculates trade size stats", () => {
			const trades = [
				makeTrade({ quantity: 0.1, entryPrice: 50000 }),
				makeTrade({ quantity: 1, entryPrice: 3000 }),
			];

			const stats = calculateAdvancedStats("m1", "Model", trades, 100000);
			// Trade sizes: 5000, 3000
			expect(stats.avgTradeSize).toBe(4000);
			expect(stats.maxTradeSize).toBe(5000);
		});

		it("calculates hold time in minutes", () => {
			const trades = [
				makeTrade({
					openedAt: new Date("2025-01-01T00:00:00Z"),
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
			];

			const stats = calculateAdvancedStats("m1", "Model", trades, 100000);
			expect(stats.avgHoldTimeMinutes).toBe(120);
			expect(stats.maxHoldTimeMinutes).toBe(120);
		});

		it("calculates long percent", () => {
			const trades = [
				makeTrade({ side: "LONG" }),
				makeTrade({ side: "LONG" }),
				makeTrade({ side: "SHORT" }),
			];

			const stats = calculateAdvancedStats("m1", "Model", trades, 100000);
			expect(stats.longPercent).toBeCloseTo(66.67, 1);
		});

		it("calculates expectancy", () => {
			const trades = [
				makeTrade({ realizedPnl: 100 }),
				makeTrade({ realizedPnl: -50 }),
				makeTrade({ realizedPnl: 200 }),
				makeTrade({ realizedPnl: -30 }),
			];

			const stats = calculateAdvancedStats("m1", "Model", trades, 100000);
			// Wins: 100, 200 -> avg 150, winPct = 0.5
			// Losses: -50, -30 -> avg 40, lossPct = 0.5
			// Expectancy = 0.5 * 150 - 0.5 * 40 = 55
			expect(stats.expectancy).toBeCloseTo(55);
		});

		it("computes failure rate from metrics", () => {
			const trades = [makeTrade()];
			const stats = calculateAdvancedStats("m1", "Model", trades, 100000, {
				failedWorkflowCount: 5,
				failedToolCallCount: 3,
				invocationCount: 40,
			});
			expect(stats.failedWorkflowCount).toBe(5);
			expect(stats.failedToolCallCount).toBe(3);
			expect(stats.failedCount).toBe(8);
			expect(stats.invocationCount).toBe(40);
			expect(stats.failureRate).toBeCloseTo(20);
		});

		it("failure rate never exceeds 100% when both failure types present on same invocations", () => {
			const trades = [makeTrade()];
			// All 10 invocations have both workflow AND tool-call failures
			// Old formula: (10 + 10) / 10 * 100 = 200% (BUG)
			// New formula: failedCount = min(10 + 10, 10) = 10, rate = 10/10 * 100 = 100%
			const stats = calculateAdvancedStats("m1", "Model", trades, 100000, {
				failedWorkflowCount: 10,
				failedToolCallCount: 10,
				invocationCount: 10,
			});
			expect(stats.failureRate).toBeCloseTo(100);
			expect(stats.failedCount).toBe(10);
		});

		it("failure rate uses explicit failedCount when provided", () => {
			const trades = [makeTrade()];
			// 10 workflow + 10 toolcall but only 8 unique failures
			const stats = calculateAdvancedStats("m1", "Model", trades, 100000, {
				failedWorkflowCount: 10,
				failedToolCallCount: 10,
				failedCount: 8,
				invocationCount: 20,
			});
			expect(stats.failedCount).toBe(8);
			expect(stats.failureRate).toBeCloseTo(40);
		});

		it("includes variant when provided", () => {
			const stats = calculateAdvancedStats(
				"m1",
				"Model",
				[],
				100000,
				undefined,
				"Contrarian",
			);
			expect(stats.variant).toBe("Contrarian");
		});
	});

	describe("calculateModelAnalytics", () => {
		it("returns both overall and advanced stats", () => {
			const trades = [
				makeTrade({ realizedPnl: 100 }),
				makeTrade({ realizedPnl: -50 }),
			];

			const analytics = calculateModelAnalytics("m1", "Model", trades, 100050);

			expect(analytics.overall.tradesCount).toBe(2);
			expect(analytics.overall.totalPnl).toBe(50);
			expect(analytics.advanced.longPercent).toBe(100);
		});

		it("propagates failure metrics to advanced stats", () => {
			const analytics = calculateModelAnalytics("m1", "Model", [], 100000, {
				failedWorkflowCount: 2,
				failedToolCallCount: 1,
				invocationCount: 10,
			});

			expect(analytics.advanced.failedWorkflowCount).toBe(2);
			expect(analytics.advanced.failedCount).toBe(3);
			expect(analytics.advanced.failureRate).toBeCloseTo(30);
		});
	});

	describe("calculateProfitFactor", () => {
		it("returns N/A when no trades", () => {
			expect(calculateProfitFactor([])).toBe("N/A");
		});

		it("returns correct ratio: wins=$300, losses=-$100 => PF=3.00", () => {
			expect(calculateProfitFactor([100, 200, -100])).toBeCloseTo(3.0);
		});

		it("returns Infinity when no losses", () => {
			expect(calculateProfitFactor([100, 200, 50])).toBe(
				Number.POSITIVE_INFINITY,
			);
		});

		it("returns 0 when no wins", () => {
			expect(calculateProfitFactor([-100, -200, -50])).toBe(0);
		});

		it("returns 0 when all P&Ls are zero", () => {
			expect(calculateProfitFactor([0, 0, 0])).toBe(0);
		});
	});

	describe("calculateRMultiple", () => {
		it("returns N/A when no trades", () => {
			expect(calculateRMultiple([])).toBe("N/A");
		});

		it("returns correct ratio: wins [$100,$200,$300], losses [-$50,-$150] => R=2.00", () => {
			// avgWin = 200, avgLoss = 100, R = 2.0
			expect(calculateRMultiple([100, 200, 300, -50, -150])).toBeCloseTo(2.0);
		});

		it("returns Infinity when no losses", () => {
			expect(calculateRMultiple([100, 200])).toBe(Number.POSITIVE_INFINITY);
		});

		it("returns 0 when no wins", () => {
			expect(calculateRMultiple([-100, -200])).toBe(0);
		});
	});

	describe("calculateDecisionQualityScore", () => {
		it("returns N/A for fewer than 3 confidence-tagged trades", () => {
			const trades = [
				makeTrade({ confidence: 80, realizedPnl: 100 }),
				makeTrade({ confidence: 60, realizedPnl: -50 }),
			];
			expect(calculateDecisionQualityScore(trades)).toBe("N/A");
		});

		it("returns N/A when all confidences are null", () => {
			const trades = [
				makeTrade({ confidence: null }),
				makeTrade({ confidence: null }),
				makeTrade({ confidence: null }),
			];
			expect(calculateDecisionQualityScore(trades)).toBe("N/A");
		});

		it("returns a correlation coefficient for >=3 tagged trades", () => {
			// High confidence + high P&L, low confidence + low P&L => positive correlation
			const trades = [
				makeTrade({ confidence: 90, realizedPnl: 200 }),
				makeTrade({ confidence: 70, realizedPnl: 100 }),
				makeTrade({ confidence: 50, realizedPnl: -50 }),
				makeTrade({ confidence: 30, realizedPnl: -100 }),
			];
			const result = calculateDecisionQualityScore(trades);
			expect(result).not.toBe("N/A");
			expect(typeof result).toBe("number");
			expect(result as number).toBeGreaterThan(0); // Positive correlation
		});

		it("returns negative correlation when confidence is anti-correlated", () => {
			const trades = [
				makeTrade({ confidence: 90, realizedPnl: -200 }),
				makeTrade({ confidence: 70, realizedPnl: -100 }),
				makeTrade({ confidence: 50, realizedPnl: 50 }),
				makeTrade({ confidence: 30, realizedPnl: 200 }),
			];
			const result = calculateDecisionQualityScore(trades);
			expect(result).not.toBe("N/A");
			expect(result as number).toBeLessThan(0);
		});
	});

	describe("calculateSortinoRatio", () => {
		it("returns N/A for fewer than 2 returns", () => {
			expect(calculateSortinoRatio([])).toBe("N/A");
			expect(calculateSortinoRatio([0.01])).toBe("N/A");
		});

		it("returns Infinity when no negative returns and mean > 0", () => {
			expect(calculateSortinoRatio([0.01, 0.02, 0.015])).toBe(
				Number.POSITIVE_INFINITY,
			);
		});

		it("returns a finite ratio with mixed returns", () => {
			// Use daily annualization (365) to keep annualized values reasonable
			const returns = [0.01, -0.02, 0.015, -0.005, 0.02, -0.01, 0.03];
			const result = calculateSortinoRatio(returns, 365);
			expect(typeof result).toBe("number");
			expect(Number.isFinite(result as number)).toBe(true);
		});

		it("returns N/A for extreme values that exceed 100", () => {
			// Tiny downside deviation with large returns
			const returns = [1, 1, 1, 1, 1, -0.0000001];
			const result = calculateSortinoRatio(returns);
			// With such extreme ratio, it should be "N/A" (exceeds 100)
			expect(result).toBe("N/A");
		});
	});

	describe("calculateCalmarRatio", () => {
		it("returns N/A when max drawdown is 0", () => {
			expect(calculateCalmarRatio(20, 0)).toBe("N/A");
		});

		it("returns correct ratio: 20% return, 10% drawdown => 2.00", () => {
			expect(calculateCalmarRatio(20, 10)).toBeCloseTo(2.0);
		});

		it("returns negative ratio for negative return", () => {
			expect(calculateCalmarRatio(-10, 20)).toBeCloseTo(-0.5);
		});
	});

	describe("calculateStreaks", () => {
		it("returns all zeros for empty trades", () => {
			const result = calculateStreaks([]);
			expect(result).toEqual({
				longestWinStreak: 0,
				longestLossStreak: 0,
				currentStreakCount: 0,
				currentStreakType: "none",
			});
		});

		it("PnLs [+50,+30,-20,-10,-15,+100] => winStreak=2, lossStreak=3, current=1-win", () => {
			const trades = [
				makeTrade({
					realizedPnl: 50,
					closedAt: new Date("2025-01-01T01:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 30,
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
				makeTrade({
					realizedPnl: -20,
					closedAt: new Date("2025-01-01T03:00:00Z"),
				}),
				makeTrade({
					realizedPnl: -10,
					closedAt: new Date("2025-01-01T04:00:00Z"),
				}),
				makeTrade({
					realizedPnl: -15,
					closedAt: new Date("2025-01-01T05:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 100,
					closedAt: new Date("2025-01-01T06:00:00Z"),
				}),
			];
			const result = calculateStreaks(trades);
			expect(result.longestWinStreak).toBe(2);
			expect(result.longestLossStreak).toBe(3);
			expect(result.currentStreakCount).toBe(1);
			expect(result.currentStreakType).toBe("win");
		});

		it("sorts by closedAt regardless of input order", () => {
			const trades = [
				makeTrade({
					realizedPnl: -20,
					closedAt: new Date("2025-01-01T03:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 50,
					closedAt: new Date("2025-01-01T01:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 30,
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
			];
			const result = calculateStreaks(trades);
			expect(result.longestWinStreak).toBe(2);
			expect(result.currentStreakCount).toBe(1);
			expect(result.currentStreakType).toBe("loss");
		});

		it("handles all wins", () => {
			const trades = [
				makeTrade({
					realizedPnl: 50,
					closedAt: new Date("2025-01-01T01:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 30,
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 20,
					closedAt: new Date("2025-01-01T03:00:00Z"),
				}),
			];
			const result = calculateStreaks(trades);
			expect(result.longestWinStreak).toBe(3);
			expect(result.longestLossStreak).toBe(0);
			expect(result.currentStreakCount).toBe(3);
			expect(result.currentStreakType).toBe("win");
		});
	});

	describe("calculateDurationDistribution", () => {
		it("returns 0,0 for empty trades", () => {
			const result = calculateDurationDistribution([]);
			expect(result.avgWinDurationMinutes).toBe(0);
			expect(result.avgLossDurationMinutes).toBe(0);
		});

		it("returns distinct averages for winners vs losers", () => {
			// Winners: 120min, Losers: 30min
			const trades = [
				makeTrade({
					realizedPnl: 100,
					openedAt: new Date("2025-01-01T00:00:00Z"),
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 200,
					openedAt: new Date("2025-01-01T00:00:00Z"),
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
				makeTrade({
					realizedPnl: -50,
					openedAt: new Date("2025-01-01T00:00:00Z"),
					closedAt: new Date("2025-01-01T00:30:00Z"),
				}),
			];
			const result = calculateDurationDistribution(trades);
			expect(result.avgWinDurationMinutes).toBeCloseTo(120);
			expect(result.avgLossDurationMinutes).toBeCloseTo(30);
		});

		it("returns 0 for avgLossDuration when no losses", () => {
			const trades = [
				makeTrade({
					realizedPnl: 100,
					openedAt: new Date("2025-01-01T00:00:00Z"),
					closedAt: new Date("2025-01-01T01:00:00Z"),
				}),
			];
			const result = calculateDurationDistribution(trades);
			expect(result.avgWinDurationMinutes).toBeCloseTo(60);
			expect(result.avgLossDurationMinutes).toBe(0);
		});
	});

	describe("calculateAdvancedStats new metrics integration", () => {
		it("returns N/A for new metrics when no trades", () => {
			const stats = calculateAdvancedStats("m1", "Model", [], 100000);
			expect(stats.profitFactor).toBe("N/A");
			expect(stats.avgRMultiple).toBe("N/A");
			expect(stats.decisionQualityScore).toBe("N/A");
			expect(stats.sortinoRatio).toBe("N/A");
			expect(stats.calmarRatio).toBe("N/A");
			expect(stats.longestWinStreak).toBe(0);
			expect(stats.longestLossStreak).toBe(0);
			expect(stats.currentStreakCount).toBe(0);
			expect(stats.currentStreakType).toBe("none");
			expect(stats.avgWinDurationMinutes).toBe(0);
			expect(stats.avgLossDurationMinutes).toBe(0);
		});

		it("computes all new metrics from trade data", () => {
			// 3 wins, 1 loss, 2 more wins at end = longest win streak of 2
			const trades = [
				makeTrade({
					realizedPnl: 300,
					confidence: 90,
					openedAt: new Date("2025-01-01T00:00:00Z"),
					closedAt: new Date("2025-01-01T02:00:00Z"),
				}),
				makeTrade({
					realizedPnl: -100,
					confidence: 40,
					openedAt: new Date("2025-01-01T02:00:00Z"),
					closedAt: new Date("2025-01-01T02:30:00Z"),
				}),
				makeTrade({
					realizedPnl: 200,
					confidence: 80,
					openedAt: new Date("2025-01-01T03:00:00Z"),
					closedAt: new Date("2025-01-01T05:00:00Z"),
				}),
				makeTrade({
					realizedPnl: 150,
					confidence: 70,
					openedAt: new Date("2025-01-01T05:00:00Z"),
					closedAt: new Date("2025-01-01T07:00:00Z"),
				}),
			];
			const stats = calculateAdvancedStats("m1", "Model", trades, 100550);

			// Profit factor: (300+200+150)/100 = 6.5
			expect(stats.profitFactor).toBeCloseTo(6.5);
			// R-multiple: mean([300,200,150]) / abs(mean([-100])) = 216.67/100 = 2.17
			expect(stats.avgRMultiple).toBeCloseTo(650 / 300, 0);
			// Decision quality: positive correlation between confidence and P&L
			expect(stats.decisionQualityScore).not.toBe("N/A");
			// Streaks: win(300), loss(-100), win(200), win(150)
			expect(stats.longestWinStreak).toBe(2);
			expect(stats.longestLossStreak).toBe(1);
			expect(stats.currentStreakCount).toBe(2);
			expect(stats.currentStreakType).toBe("win");
			// Duration: winners avg 120min, loser 30min
			expect(stats.avgWinDurationMinutes).toBeCloseTo(120);
			expect(stats.avgLossDurationMinutes).toBeCloseTo(30);
			// Sortino and Calmar should be numbers (not N/A) with this data
			expect(stats.sortinoRatio).not.toBe("N/A");
			expect(stats.calmarRatio).not.toBe("N/A");
		});
	});
});
