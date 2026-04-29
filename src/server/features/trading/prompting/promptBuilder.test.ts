import { describe, it, expect } from "vitest";
import { buildStateSummary } from "./promptBuilder";
import type { PortfolioSnapshot } from "@/server/features/trading/data/portfolio";
import type {
	EnrichedOpenPosition,
	ExposureSummary,
} from "@/server/features/trading/data/openPositionEnrichment";

const makePortfolio = (
	overrides: Partial<PortfolioSnapshot> = {},
): PortfolioSnapshot => ({
	totalValue: 100000,
	availableCash: 80000,
	...overrides,
});

const makePosition = (
	overrides: Partial<EnrichedOpenPosition> = {},
): EnrichedOpenPosition => ({
	symbol: "BTC",
	position: "0.5000",
	quantity: 0.5,
	side: "LONG",
	unrealizedPnl: 150,
	realizedPnl: 0,
	liquidationPrice: null,
	notional: "25000.00",
	entryPrice: 50000,
	markPrice: 50300,
	costBasis: 25000,
	unrealizedIntradayPl: 150,
	unrealizedIntradayPlpc: 0.006,
	changeToday: 0.003,
	exitPlan: null,
	confidence: null,
	lastDecisionAt: null,
	decisionStatus: null,
	notionalUsd: 25000,
	riskUsd: null,
	riskPercent: null,
	rewardUsd: null,
	rewardPercent: null,
	riskRewardRatio: null,
	...overrides,
});

const makeExposureSummary = (
	overrides: Partial<ExposureSummary> = {},
): ExposureSummary => ({
	totalNotional: 25000,
	longExposure: 25000,
	shortExposure: 0,
	totalUnrealized: 150,
	totalRealized: 0,
	totalRiskUsd: 0,
	maxPositionRiskUsd: 0,
	...overrides,
});

describe("promptBuilder", () => {
	describe("buildStateSummary", () => {
		it("includes cash, exposure, and portfolio value", () => {
			const result = buildStateSummary({
				portfolio: makePortfolio(),
				openPositions: [],
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("Cash: $80000.00");
			expect(result).toContain("Portfolio: $100000.00");
			expect(result).toContain("[STATE UPDATE]");
		});

		it("shows 'No open positions' when empty", () => {
			const result = buildStateSummary({
				portfolio: makePortfolio(),
				openPositions: [],
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("No open positions");
		});

		it("formats open positions with symbol, side, entry, and P&L", () => {
			const result = buildStateSummary({
				portfolio: makePortfolio(),
				openPositions: [makePosition()],
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("BTC LONG @ 50000.00");
			expect(result).toContain("+$150.00");
		});

		it("formats negative P&L correctly", () => {
			const result = buildStateSummary({
				portfolio: makePortfolio(),
				openPositions: [makePosition({ unrealizedPnl: -200 })],
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("$-200.00");
		});

		it("shows N/A for missing entry price", () => {
			const result = buildStateSummary({
				portfolio: makePortfolio(),
				openPositions: [makePosition({ entryPrice: null })],
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("N/A");
		});

		it("computes exposure percentage from portfolio", () => {
			// 20000 deployed out of 100000 = 20%
			const result = buildStateSummary({
				portfolio: makePortfolio({
					totalValue: 100000,
					availableCash: 80000,
				}),
				openPositions: [],
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("Exposure: 20.0%");
		});

		it("handles multiple positions", () => {
			const positions = [
				makePosition({ symbol: "BTC", unrealizedPnl: 100 }),
				makePosition({
					symbol: "ETH",
					side: "SHORT",
					entryPrice: 3000,
					unrealizedPnl: -50,
				}),
			];

			const result = buildStateSummary({
				portfolio: makePortfolio(),
				openPositions: positions,
				exposureSummary: makeExposureSummary(),
			});

			expect(result).toContain("BTC LONG");
			expect(result).toContain("ETH SHORT");
		});
	});
});
