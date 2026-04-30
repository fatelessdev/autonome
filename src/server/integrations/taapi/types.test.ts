import { describe, expect, it } from "vitest";
import { AVAILABLE_TAAPI_INDICATORS, TAAPI_FREE_PLAN_SYMBOLS } from "./types";

describe("types", () => {
	it("exports expected members", () => {
		expect(TAAPI_FREE_PLAN_SYMBOLS).toBeDefined();
		expect(AVAILABLE_TAAPI_INDICATORS).toBeDefined();
	});
});
