import { describe, expect, it } from "vitest";
import { createPositionTool } from "./createPositionTool";

describe("createPositionTool", () => {
	it("exports expected members", () => {
		expect(createPositionTool).toBeDefined();
	});
});
