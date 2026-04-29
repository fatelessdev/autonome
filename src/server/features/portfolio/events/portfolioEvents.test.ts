import { describe, it, expect } from "vitest";
import { emitPortfolioEvent, subscribeToPortfolioEvents, getPortfolioCacheMetadata, getCurrentPortfolioSummary } from "./portfolioEvents";

describe("portfolioEvents", () => {
	it("exports expected members", () => {
		expect(emitPortfolioEvent).toBeDefined();
		expect(subscribeToPortfolioEvents).toBeDefined();
		expect(getPortfolioCacheMetadata).toBeDefined();
		expect(getCurrentPortfolioSummary).toBeDefined();
	});
});
