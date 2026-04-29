import { describe, it, expect } from "vitest";
import { MAX_ACTIONS_PER_SYMBOL } from "./types";

describe("types", () => {
	it("exports expected members", () => {
		expect(MAX_ACTIONS_PER_SYMBOL).toBeDefined();
		expect(MAX_ACTIONS_PER_SYMBOL).toBe(3);
	});
});
