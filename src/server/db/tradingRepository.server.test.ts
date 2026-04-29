import { describe, it, expect } from "vitest";
import { listModelsQuery, listModelsOrderedQuery, portfolioHistoryQuery, recentToolCallsQuery, recentToolCallsWithModelQuery } from "./tradingRepository.server";

describe("tradingRepository.server", () => {
	it("exports expected members", () => {
		expect(listModelsQuery).toBeDefined();
		expect(listModelsOrderedQuery).toBeDefined();
		expect(portfolioHistoryQuery).toBeDefined();
		expect(recentToolCallsQuery).toBeDefined();
		expect(recentToolCallsWithModelQuery).toBeDefined();
	});
});
