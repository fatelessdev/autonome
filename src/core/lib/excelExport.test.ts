import { describe, expect, it } from "vitest";
import {
	exportAnalyticsToExcel,
	exportLeaderboardToExcel,
} from "./excelExport";

describe("excelExport", () => {
	it("exports expected members", () => {
		expect(exportAnalyticsToExcel).toBeDefined();
		expect(exportLeaderboardToExcel).toBeDefined();
	});
});
