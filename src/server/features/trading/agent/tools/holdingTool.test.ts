import { describe, expect, it } from "vitest";
import { holdingTool } from "./holdingTool";

describe("holdingTool", () => {
	it("exports expected members", () => {
		expect(holdingTool).toBeDefined();
	});
});
