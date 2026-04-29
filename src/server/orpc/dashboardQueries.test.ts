import { describe, it, expect } from "vitest";
import { DASHBOARD_QUERY_KEYS, tradesQueryOptions, positionsQueryOptions, conversationsQueryOptions, DASHBOARD_QUERIES } from "./dashboardQueries";

describe("dashboardQueries", () => {
	it("exports expected members", () => {
		expect(DASHBOARD_QUERY_KEYS).toBeDefined();
		expect(tradesQueryOptions).toBeDefined();
		expect(positionsQueryOptions).toBeDefined();
		expect(conversationsQueryOptions).toBeDefined();
		expect(DASHBOARD_QUERIES).toBeDefined();
	});
});
