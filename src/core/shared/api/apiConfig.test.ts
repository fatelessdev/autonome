import { describe, it, expect } from "vitest";
import { getApiBaseUrl, getSseUrl, getRpcUrl } from "./apiConfig";

describe("apiConfig", () => {
	it("exports expected members", () => {
		expect(getApiBaseUrl).toBeDefined();
		expect(getSseUrl).toBeDefined();
		expect(getRpcUrl).toBeDefined();
	});
});
