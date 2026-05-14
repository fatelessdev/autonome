import { describe, expect, it } from "vitest";
import type { TradingDecisionWithContext } from "../contracts/tradingDecisions";
import {
	computeRiskMetrics,
	enrichOpenPositions,
	resolveNotionalUsd,
	resolveQuantity,
	summarizePositionRisk,
} from "./openPositionEnrichment";
import type { OpenPositionSummary } from "./positions";

function makePosition(
	overrides: Partial<OpenPositionSummary> = {},
): OpenPositionSummary {
	return {
		symbol: "BTC",
		position: "1.5000",
		quantity: 1.5,
		side: "LONG",
		unrealizedPnl: 100,
		realizedPnl: 0,
		liquidationPrice: null,
		notional: "75000",
		entryPrice: 50000,
		markPrice: 51000,
		costBasis: 75000,
		unrealizedIntradayPl: 100,
		unrealizedIntradayPlpc: 0.01,
		changeToday: 0.01,
		exitPlan: null,
		confidence: null,
		lastDecisionAt: null,
		decisionStatus: null,
		...overrides,
	};
}

describe("openPositionEnrichment", () => {
	describe("resolveQuantity", () => {
		it("resolves from numeric quantity field", () => {
			expect(resolveQuantity(makePosition({ quantity: 2.5 }))).toBe(2.5);
		});

		it("returns absolute value for negative quantity", () => {
			expect(resolveQuantity(makePosition({ quantity: -3 }))).toBe(3);
		});

		it("falls back to parsing position string", () => {
			expect(
				resolveQuantity(
					makePosition({ quantity: Number.NaN, position: "4.5000" }),
				),
			).toBe(4.5);
		});

		it("returns null when both are invalid", () => {
			expect(
				resolveQuantity(
					makePosition({ quantity: Number.NaN, position: "abc" }),
				),
			).toBeNull();
		});

		it("returns null for non-finite quantity", () => {
			expect(
				resolveQuantity(makePosition({ quantity: Infinity, position: "abc" })),
			).toBeNull();
		});
	});

	describe("resolveNotionalUsd", () => {
		it("resolves from notional string", () => {
			const pos = makePosition({ notional: "50000" });
			expect(resolveNotionalUsd(pos)).toBe(50000);
		});

		it("returns absolute notional", () => {
			const pos = makePosition({ notional: "-50000" });
			expect(resolveNotionalUsd(pos)).toBe(50000);
		});

		it("falls back to quantity * entryPrice", () => {
			const pos = makePosition({ notional: undefined, entryPrice: 50000 });
			expect(resolveNotionalUsd(pos)).toBe(75000); // 1.5 * 50000
		});

		it("falls back to quantity * markPrice", () => {
			const pos = makePosition({
				notional: undefined,
				entryPrice: null,
				markPrice: 40000,
			});
			expect(resolveNotionalUsd(pos)).toBe(60000); // 1.5 * 40000
		});

		it("returns null when nothing is available", () => {
			const pos = makePosition({
				notional: undefined,
				entryPrice: null,
				markPrice: null,
				quantity: Number.NaN,
				position: "abc",
			});
			expect(resolveNotionalUsd(pos)).toBeNull();
		});
	});

	describe("computeRiskMetrics", () => {
		it("calculates risk and reward for a LONG position", () => {
			const position = makePosition({
				side: "LONG",
				entryPrice: 100,
				quantity: 10,
			});
			const exitPlan = {
				target: 120,
				stop: 90,
				invalidation: null,
				invalidationPrice: null,
				timeExit: null,
				cooldownUntil: null,
			};
			const result = computeRiskMetrics(position, exitPlan, 1000);

			// risk = (100 - 90) * 10 = 100
			expect(result.riskUsd).toBe(100);
			// riskPct = 100/1000 * 100 = 10
			expect(result.riskPercent).toBe(10);
			// reward = (120 - 100) * 10 = 200
			expect(result.rewardUsd).toBe(200);
			// rewardPct = 200/1000 * 100 = 20
			expect(result.rewardPercent).toBe(20);
			// rr = 200/100 = 2
			expect(result.riskRewardRatio).toBe(2);
		});

		it("calculates risk and reward for a SHORT position", () => {
			const position = makePosition({
				side: "SHORT",
				entryPrice: 100,
				quantity: 10,
			});
			const exitPlan = {
				target: 80,
				stop: 110,
				invalidation: null,
				invalidationPrice: null,
				timeExit: null,
				cooldownUntil: null,
			};
			const result = computeRiskMetrics(position, exitPlan, 1000);

			// risk = (110 - 100) * 10 = 100
			expect(result.riskUsd).toBe(100);
			// reward = (100 - 80) * 10 = 200
			expect(result.rewardUsd).toBe(200);
			expect(result.riskRewardRatio).toBe(2);
		});

		it("returns nulls when exit plan is null", () => {
			const position = makePosition();
			const result = computeRiskMetrics(position, null, 1000);

			expect(result.riskUsd).toBeNull();
			expect(result.rewardUsd).toBeNull();
			expect(result.riskRewardRatio).toBeNull();
		});

		it("returns null risk when stop is above entry for LONG", () => {
			const position = makePosition({
				side: "LONG",
				entryPrice: 100,
				quantity: 10,
			});
			const exitPlan = {
				target: 120,
				stop: 105,
				invalidation: null,
				invalidationPrice: null,
				timeExit: null,
				cooldownUntil: null,
			};
			const result = computeRiskMetrics(position, exitPlan, 1000);

			// diff = 100 - 105 = -5, not > 0
			expect(result.riskUsd).toBeNull();
		});
	});

	describe("enrichOpenPositions", () => {
		it("enriches a basic position with defaults", () => {
			const positions = [makePosition()];
			const enriched = enrichOpenPositions(positions, new Map());

			expect(enriched).toHaveLength(1);
			expect(enriched[0].symbol).toBe("BTC");
			expect(enriched[0].notionalUsd).toBe(75000);
			expect(enriched[0].confidence).toBeNull();
			expect(enriched[0].decisionStatus).toBeNull();
		});

		it("merges decision metadata from decision index", () => {
			const positions = [makePosition()];
			const decisionIndex = new Map([
				[
					"BTC",
					{
						symbol: "BTC",
						side: "LONG",
						quantity: 1.5,
						profitTarget: 55000,
						stopLoss: 48000,
						confidence: 8,
						status: "FILLED",
						toolCallId: "tool-call-1",
						createdAt: new Date("2024-01-15"),
						invalidationCondition: null,
						invalidationPrice: null,
						timeExit: null,
						cooldownUntil: null,
					} satisfies TradingDecisionWithContext,
				],
			]);

			const enriched = enrichOpenPositions(positions, decisionIndex);

			expect(enriched[0].exitPlan).toEqual({
				target: 55000,
				stop: 48000,
				invalidation: null,
				invalidationPrice: null,
				timeExit: null,
				cooldownUntil: null,
			});
			expect(enriched[0].confidence).toBe(8);
			expect(enriched[0].decisionStatus).toBe("FILLED");
			expect(enriched[0].riskUsd).not.toBeNull();
		});

		it("handles empty positions array", () => {
			expect(enrichOpenPositions([], new Map())).toEqual([]);
		});
	});

	describe("summarizePositionRisk", () => {
		it("summarizes exposure and risk from enriched positions", () => {
			const positions = enrichOpenPositions(
				[
					makePosition({
						side: "LONG",
						notional: "50000",
						unrealizedPnl: 100,
						realizedPnl: 0,
					}),
					makePosition({
						symbol: "ETH",
						side: "SHORT",
						notional: "30000",
						unrealizedPnl: -50,
						realizedPnl: 0,
					}),
				],
				new Map(),
			);

			const summary = summarizePositionRisk(positions);

			expect(summary.totalNotional).toBe(80000);
			expect(summary.longExposure).toBe(50000);
			expect(summary.shortExposure).toBe(30000);
			expect(summary.totalUnrealized).toBe(50); // 100 + (-50)
		});

		it("returns zero summary for empty positions", () => {
			const summary = summarizePositionRisk([]);
			expect(summary.totalNotional).toBe(0);
			expect(summary.longExposure).toBe(0);
			expect(summary.shortExposure).toBe(0);
			expect(summary.totalUnrealized).toBe(0);
			expect(summary.totalRealized).toBe(0);
		});

		it("throws for invalid unrealizedPnl", () => {
			const positions = enrichOpenPositions(
				[makePosition({ unrealizedPnl: Number.NaN })],
				new Map(),
			);
			expect(() => summarizePositionRisk(positions)).toThrow(
				"Missing or invalid unrealizedPnl",
			);
		});
	});
});
