import { describe, expect, it } from "vitest";
import {
	listModelsOrderedQuery,
	listModelsQuery,
	portfolioHistoryQuery,
	recentToolCallsQuery,
	recentToolCallsWithModelQuery,
} from "./tradingRepository.server";

describe("tradingRepository.server", () => {
	it("exports expected members", () => {
		expect(listModelsQuery).toBeDefined();
		expect(listModelsOrderedQuery).toBeDefined();
		expect(portfolioHistoryQuery).toBeDefined();
		expect(recentToolCallsQuery).toBeDefined();
		expect(recentToolCallsWithModelQuery).toBeDefined();
	});
});
