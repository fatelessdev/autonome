import { describe, it, expect } from "vitest";
import { openPositionsQuery } from "./positions.server";

describe("positions.server", () => {
	it("exports expected members", () => {
		expect(openPositionsQuery).toBeDefined();
	});
});
