import { describe, expect, it } from "vitest";
import { fetchIndicatorsTool } from "./fetchIndicatorsTool";

describe("fetchIndicatorsTool", () => {
	it("exports expected members", () => {
		expect(fetchIndicatorsTool).toBeDefined();
	});
});
