import { describe, it, expect } from "vitest";
import { portfolioQuery } from "./portfolio.server";

describe("portfolio.server", () => {
	it("exports expected members", () => {
		expect(portfolioQuery).toBeDefined();
	});
});
