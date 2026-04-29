import { describe, it, expect } from "vitest";
import { TAAPI_FREE_PLAN_SYMBOLS, AVAILABLE_TAAPI_INDICATORS } from "./types";

describe("types", () => {
	it("exports expected members", () => {
		expect(TAAPI_FREE_PLAN_SYMBOLS).toBeDefined();
		expect(AVAILABLE_TAAPI_INDICATORS).toBeDefined();
	});
});
