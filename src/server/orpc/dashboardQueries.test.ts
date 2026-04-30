import { describe, expect, it } from "vitest";
import {
	conversationsQueryOptions,
	DASHBOARD_QUERIES,
	DASHBOARD_QUERY_KEYS,
	positionsQueryOptions,
	tradesQueryOptions,
} from "./dashboardQueries";

describe("dashboardQueries", () => {
	it("exports expected members", () => {
		expect(DASHBOARD_QUERY_KEYS).toBeDefined();
		expect(tradesQueryOptions).toBeDefined();
		expect(positionsQueryOptions).toBeDefined();
		expect(conversationsQueryOptions).toBeDefined();
		expect(DASHBOARD_QUERIES).toBeDefined();
	});
});
