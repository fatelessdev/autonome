import { describe, it, expect } from "vitest";
import { fetchIndicatorsTool } from "./fetchIndicatorsTool";

describe("fetchIndicatorsTool", () => {
	it("exports expected members", () => {
		expect(fetchIndicatorsTool).toBeDefined();
	});
});
