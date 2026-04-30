import { describe, expect, it } from "vitest";
import {
	getFailures,
	getLeaderboard,
	getModelStats,
	getRunInfo,
} from "./analytics";

describe("analytics", () => {
	it("exports expected members", () => {
		expect(getModelStats).toBeDefined();
		expect(getLeaderboard).toBeDefined();
		expect(getFailures).toBeDefined();
		expect(getRunInfo).toBeDefined();
	});
});
