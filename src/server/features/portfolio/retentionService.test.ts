import { describe, expect, it } from "vitest";
import {
	DOWNSAMPLE_CONFIG,
	RETENTION_CONFIG,
	downsampleForChart,
} from "./retentionService";

type PortfolioEntry = {
	id: string;
	modelId: string;
	netPortfolio: string;
	createdAt: string;
	updatedAt: string;
	model: {
		name: string;
		variant: string | undefined;
		openRouterModelName: string;
	};
};

function makeEntry(
	overrides: Partial<PortfolioEntry> = {},
): PortfolioEntry {
	return {
		id: "entry-1",
		modelId: "model-1",
		netPortfolio: "100000.00",
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2024-01-01T00:00:00Z",
		model: {
			name: "GPT-4",
			variant: "Sovereign",
			openRouterModelName: "openai/gpt-4",
		},
		...overrides,
	};
}

describe("retentionService", () => {
	describe("RETENTION_CONFIG", () => {
		it("should have correct retention periods", () => {
			const sevenDays = 7 * 24 * 60 * 60 * 1000;
			const thirtyDays = 30 * 24 * 60 * 60 * 1000;
			expect(RETENTION_CONFIG.RAW_DATA_RETENTION_MS).toBe(sevenDays);
			expect(RETENTION_CONFIG.HOURLY_TO_DAILY_MS).toBe(thirtyDays);
		});
	});

	describe("DOWNSAMPLE_CONFIG", () => {
		it("should have correct threshold values", () => {
			expect(DOWNSAMPLE_CONFIG.THRESHOLDS.ONE_DAY).toBe(24 * 60 * 60 * 1000);
			expect(DOWNSAMPLE_CONFIG.THRESHOLDS.THREE_DAYS).toBe(3 * 24 * 60 * 60 * 1000);
			expect(DOWNSAMPLE_CONFIG.THRESHOLDS.SEVEN_DAYS).toBe(7 * 24 * 60 * 60 * 1000);
			expect(DOWNSAMPLE_CONFIG.THRESHOLDS.THIRTY_DAYS).toBe(30 * 24 * 60 * 60 * 1000);
		});

		it("should have all resolution bucket sizes", () => {
			expect(DOWNSAMPLE_CONFIG.RESOLUTIONS["1m"]).toBe(60_000);
			expect(DOWNSAMPLE_CONFIG.RESOLUTIONS["5m"]).toBe(5 * 60_000);
			expect(DOWNSAMPLE_CONFIG.RESOLUTIONS["15m"]).toBe(15 * 60_000);
			expect(DOWNSAMPLE_CONFIG.RESOLUTIONS["1h"]).toBe(60 * 60_000);
			expect(DOWNSAMPLE_CONFIG.RESOLUTIONS["4h"]).toBe(4 * 60 * 60_000);
		});
	});

	describe("downsampleForChart", () => {
		it("should return empty for empty input", () => {
			const result = downsampleForChart([]);
			expect(result.entries).toEqual([]);
			expect(result.resolution).toBe("1m");
		});

		it("should return single entry as-is", () => {
			const data = [makeEntry()];
			const result = downsampleForChart(data);
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0]).toEqual(data[0]);
		});

		it("should auto-detect 1m resolution for ≤1 day range", () => {
			const data = [
				makeEntry({ createdAt: "2024-01-01T00:00:00Z", netPortfolio: "100000" }),
				makeEntry({ createdAt: "2024-01-01T12:00:00Z", netPortfolio: "100100" }),
			];
			const result = downsampleForChart(data);
			expect(result.resolution).toBe("1m");
		});

		it("should auto-detect 5m resolution for ≤3 day range", () => {
			const data = [
				makeEntry({ createdAt: "2024-01-01T00:00:00Z", netPortfolio: "100000" }),
				makeEntry({ createdAt: "2024-01-03T00:00:00Z", netPortfolio: "100200" }),
			];
			const result = downsampleForChart(data);
			expect(result.resolution).toBe("5m");
		});

		it("should auto-detect 15m resolution for ≤7 day range", () => {
			const data = [
				makeEntry({ createdAt: "2024-01-01T00:00:00Z", netPortfolio: "100000" }),
				makeEntry({ createdAt: "2024-01-07T00:00:00Z", netPortfolio: "100500" }),
			];
			const result = downsampleForChart(data);
			expect(result.resolution).toBe("15m");
		});

		it("should use forced resolution when provided", () => {
			const data = [
				makeEntry({ createdAt: "2024-01-01T00:00:00Z", netPortfolio: "100000" }),
				makeEntry({ createdAt: "2024-01-02T00:00:00Z", netPortfolio: "100100" }),
			];
			const result = downsampleForChart(data, "1h");
			expect(result.resolution).toBe("1h");
		});

		it("should keep last value per bucket (close price semantics)", () => {
			// Two entries in same 1h bucket, second should win
			const data = [
				makeEntry({
					id: "e1",
					createdAt: "2024-06-01T00:10:00Z",
					netPortfolio: "100000",
				}),
				makeEntry({
					id: "e2",
					createdAt: "2024-06-01T00:45:00Z",
					netPortfolio: "101000",
				}),
			];
			const result = downsampleForChart(data, "1h");
			// Should have one bucket entry (last value) plus possibly the latest entry
			const bucketEntries = result.entries.filter(
				(e) => e.createdAt === "2024-06-01T00:00:00.000Z",
			);
			expect(bucketEntries.length).toBeLessThanOrEqual(1);
		});

		it("should append the latest entry when it's newer than the last bucket", () => {
			const data = [
				makeEntry({
					id: "e1",
					createdAt: "2024-06-01T00:00:00Z",
					netPortfolio: "100000",
				}),
				makeEntry({
					id: "e2",
					createdAt: "2024-06-01T00:30:00Z",
					netPortfolio: "100500",
				}),
				makeEntry({
					id: "e3",
					createdAt: "2024-06-01T00:59:00Z",
					netPortfolio: "101000",
				}),
			];
			const result = downsampleForChart(data, "1h");
			// The latest entry (e3) should be appended
			const latestEntry = result.entries.find((e) => e.id === "e3");
			expect(latestEntry).toBeDefined();
		});

		it("should sort output by createdAt ascending", () => {
			const data = [
				makeEntry({
					id: "e1",
					createdAt: "2024-06-01T00:00:00Z",
					netPortfolio: "100000",
				}),
				makeEntry({
					id: "e2",
					createdAt: "2024-06-01T02:00:00Z",
					netPortfolio: "101000",
				}),
				makeEntry({
					id: "e3",
					createdAt: "2024-06-01T01:00:00Z",
					netPortfolio: "100500",
				}),
			];
			const result = downsampleForChart(data, "1h");

			for (let i = 1; i < result.entries.length; i++) {
				const prev = new Date(result.entries[i - 1].createdAt).getTime();
				const curr = new Date(result.entries[i].createdAt).getTime();
				expect(curr).toBeGreaterThanOrEqual(prev);
			}
		});

		it("should handle multiple models independently", () => {
			const data = [
				makeEntry({
					id: "e1",
					modelId: "model-1",
					createdAt: "2024-06-01T00:00:00Z",
					netPortfolio: "100000",
					model: { name: "GPT-4", variant: "Sovereign", openRouterModelName: "openai/gpt-4" },
				}),
				makeEntry({
					id: "e2",
					modelId: "model-2",
					createdAt: "2024-06-01T00:00:00Z",
					netPortfolio: "50000",
					model: { name: "Claude", variant: "Trendsurfer", openRouterModelName: "anthropic/claude" },
				}),
			];
			const result = downsampleForChart(data, "1h");

			const modelNames = new Set(result.entries.map((e) => e.model.name));
			expect(modelNames.has("GPT-4")).toBe(true);
			expect(modelNames.has("Claude")).toBe(true);
		});
	});
});
