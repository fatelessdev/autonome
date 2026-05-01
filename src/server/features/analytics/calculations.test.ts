import { describe, expect, it } from "vitest";
import {
	calculateAdvancedStats,
	calculateModelAnalytics,
	calculateOverallStats,
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
});
