import { describe, expect, it } from "vitest";
import {
	emitPortfolioEvent,
	getCurrentPortfolioSummary,
	getPortfolioCacheMetadata,
	subscribeToPortfolioEvents,
} from "./portfolioEvents";

describe("portfolioEvents", () => {
	it("exports expected members", () => {
		expect(emitPortfolioEvent).toBeDefined();
		expect(subscribeToPortfolioEvents).toBeDefined();
		expect(getPortfolioCacheMetadata).toBeDefined();
		expect(getCurrentPortfolioSummary).toBeDefined();
	});
});
