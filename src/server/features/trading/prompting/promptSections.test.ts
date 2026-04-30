import { describe, expect, it } from "vitest";
import type { ExposureSummary } from "../data/openPositionEnrichment";
import type { PortfolioSnapshot } from "../data/portfolio";
import { calculateExposureToEquityPct } from "./promptSections";

function makePortfolio(
	overrides: Partial<PortfolioSnapshot> = {},
): PortfolioSnapshot {
	return {
		totalValue: 100000,
		availableCash: 60000,
		...overrides,
	};
}

function makeExposure(
	overrides: Partial<ExposureSummary> = {},
): ExposureSummary {
	return {
		totalNotional: 40000,
		longExposure: 30000,
		shortExposure: 10000,
		totalUnrealized: 500,
		totalRealized: 0,
		totalRiskUsd: 2000,
		maxPositionRiskUsd: 1500,
		...overrides,
	};
}

describe("promptSections", () => {
	describe("calculateExposureToEquityPct", () => {
		it("calculates cash utilization percentage", () => {
			// deployed = 100000 - 60000 = 40000
			// pct = 40000/100000 * 100 = 40
			const result = calculateExposureToEquityPct(
				makePortfolio(),
				makeExposure(),
			);
			expect(result).toBe(40);
		});

		it("returns 100 when all cash is deployed", () => {
			const portfolio = makePortfolio({ availableCash: 0 });
			const result = calculateExposureToEquityPct(portfolio, makeExposure());
			expect(result).toBe(100);
		});

		it("returns 0 when no cash is deployed", () => {
			const portfolio = makePortfolio({ availableCash: 100000 });
			const result = calculateExposureToEquityPct(portfolio, makeExposure());
			expect(result).toBe(0);
		});

		it("returns null when totalValue is 0", () => {
			const portfolio = makePortfolio({ totalValue: 0 });
			const result = calculateExposureToEquityPct(portfolio, makeExposure());
			expect(result).toBeNull();
		});

		it("returns null when totalValue is negative", () => {
			const portfolio = makePortfolio({ totalValue: -1000 });
			const result = calculateExposureToEquityPct(portfolio, makeExposure());
			expect(result).toBeNull();
		});

		it("clamps to 0 when availableCash exceeds totalValue", () => {
			const portfolio = makePortfolio({ availableCash: 120000 });
			const result = calculateExposureToEquityPct(portfolio, makeExposure());
			// deployed = max(100000 - 120000, 0) = 0
			expect(result).toBe(0);
		});
	});
});
