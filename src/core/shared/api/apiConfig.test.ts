import { describe, expect, it } from "vitest";
import { getApiBaseUrl, getRpcUrl, getSseUrl } from "./apiConfig";

describe("apiConfig", () => {
	it("exports expected members", () => {
		expect(getApiBaseUrl).toBeDefined();
		expect(getSseUrl).toBeDefined();
		expect(getRpcUrl).toBeDefined();
	});
});
