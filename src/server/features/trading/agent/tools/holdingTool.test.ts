import { describe, it, expect } from "vitest";
import { holdingTool } from "./holdingTool";

describe("holdingTool", () => {
	it("exports expected members", () => {
		expect(holdingTool).toBeDefined();
	});
});
