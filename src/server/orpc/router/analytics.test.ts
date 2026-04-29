import { describe, it, expect } from "vitest";
import { getModelStats, getLeaderboard, getFailures, getRunInfo } from "./analytics";

describe("analytics", () => {
	it("exports expected members", () => {
		expect(getModelStats).toBeDefined();
		expect(getLeaderboard).toBeDefined();
		expect(getFailures).toBeDefined();
		expect(getRunInfo).toBeDefined();
	});
});
