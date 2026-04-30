import { describe, expect, it } from "vitest";
import {
	DESKTOP_POINT_BUDGET,
	MIN_SAMPLE_THRESHOLD,
	MOBILE_POINT_BUDGET,
	timeBasedSample,
	uniformStrideSample,
} from "./chartSampler";

describe("chartSampler", () => {
	it("exports expected members", () => {
		expect(DESKTOP_POINT_BUDGET).toBeDefined();
		expect(MOBILE_POINT_BUDGET).toBeDefined();
		expect(MIN_SAMPLE_THRESHOLD).toBeDefined();
		expect(timeBasedSample).toBeDefined();
		expect(uniformStrideSample).toBeDefined();
	});
});
