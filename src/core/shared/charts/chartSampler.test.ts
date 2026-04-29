import { describe, it, expect } from "vitest";
import { DESKTOP_POINT_BUDGET, MOBILE_POINT_BUDGET, MIN_SAMPLE_THRESHOLD, timeBasedSample, uniformStrideSample } from "./chartSampler";

describe("chartSampler", () => {
	it("exports expected members", () => {
		expect(DESKTOP_POINT_BUDGET).toBeDefined();
		expect(MOBILE_POINT_BUDGET).toBeDefined();
		expect(MIN_SAMPLE_THRESHOLD).toBeDefined();
		expect(timeBasedSample).toBeDefined();
		expect(uniformStrideSample).toBeDefined();
	});
});
