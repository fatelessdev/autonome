import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAllOpenInterest } from "./client";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("fetchAllOpenInterest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fetches OI data for multiple assets in parallel", async () => {
		const btcResponse = [
			{
				symbol: "BTCUSDT",
				sumOpenInterest: "50000.000",
				sumOpenInterestValue: "3000000000.00",
				timestamp: 1714500000000,
			},
			{
				symbol: "BTCUSDT",
				sumOpenInterest: "52000.000",
				sumOpenInterestValue: "3120000000.00",
				timestamp: 1714503600000,
			},
		];

		const ethResponse = [
			{
				symbol: "ETHUSDT",
				sumOpenInterest: "1000000.000",
				sumOpenInterestValue: "3500000000.00",
				timestamp: 1714500000000,
			},
			{
				symbol: "ETHUSDT",
				sumOpenInterest: "1050000.000",
				sumOpenInterestValue: "3675000000.00",
				timestamp: 1714503600000,
			},
		];

		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => btcResponse,
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ethResponse,
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			});

		const result = await fetchAllOpenInterest();

		// Should have data for BTC and ETH (others return empty)
		expect(result.size).toBe(2);

		const btcData = result.get("BTC");
		expect(btcData).toBeDefined();
		expect(btcData?.symbol).toBe("BTC");
		expect(btcData?.openInterest).toBe(52000);
		expect(btcData?.openInterestValueUsd).toBe(3120000000);
		expect(btcData?.changePercent).toBe(4); // 4% increase

		const ethData = result.get("ETH");
		expect(ethData).toBeDefined();
		expect(ethData?.symbol).toBe("ETH");
		expect(ethData?.openInterest).toBe(1050000);
		expect(ethData?.changePercent).toBe(5); // 5% increase

		// Should have called fetch 5 times (one per market)
		expect(mockFetch).toHaveBeenCalledTimes(5);
	});

	it("returns empty map when all fetches fail", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			text: async () => "Server error",
		});

		const result = await fetchAllOpenInterest();

		expect(result.size).toBe(0);
	});

	it("returns partial results when some fetches fail", async () => {
		// BTC succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => [
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "50000.000",
					sumOpenInterestValue: "3000000000.00",
					timestamp: 1714500000000,
				},
			],
		});

		// ETH fails
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
			text: async () => "Symbol not found",
		});

		// SOL, XRP, HYPE return empty
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			});

		const result = await fetchAllOpenInterest();

		expect(result.size).toBe(1);
		expect(result.get("BTC")).toBeDefined();
		expect(result.get("ETH")).toBeUndefined();
	});

	it("handles empty response array", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [],
		});

		const result = await fetchAllOpenInterest();

		expect(result.size).toBe(0);
	});

	it("handles single data point (no change calculation)", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "50000.000",
					sumOpenInterestValue: "3000000000.00",
					timestamp: 1714500000000,
				},
			],
		});

		const result = await fetchAllOpenInterest(["BTC"]);

		expect(result.size).toBe(1);
		const btcData = result.get("BTC");
		expect(btcData?.changePercent).toBe(0);
	});

	it("correctly computes percentage change", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "100000.000",
					sumOpenInterestValue: "5000000000.00",
					timestamp: 1714500000000,
				},
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "110000.000",
					sumOpenInterestValue: "5500000000.00",
					timestamp: 1714503600000,
				},
			],
		});

		const result = await fetchAllOpenInterest(["BTC"]);

		const btcData = result.get("BTC");
		expect(btcData?.changePercent).toBe(10); // 10% increase
	});

	it("handles negative percentage change", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "100000.000",
					sumOpenInterestValue: "5000000000.00",
					timestamp: 1714500000000,
				},
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "90000.000",
					sumOpenInterestValue: "4500000000.00",
					timestamp: 1714503600000,
				},
			],
		});

		const result = await fetchAllOpenInterest(["BTC"]);

		const btcData = result.get("BTC");
		expect(btcData?.changePercent).toBe(-10); // 10% decrease
	});

	it("filters to specified symbols", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [
				{
					symbol: "BTCUSDT",
					sumOpenInterest: "50000.000",
					sumOpenInterestValue: "3000000000.00",
					timestamp: 1714500000000,
				},
			],
		});

		const result = await fetchAllOpenInterest(["BTC"]);

		expect(result.size).toBe(1);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("symbol=BTCUSDT"),
			expect.any(Object),
		);
	});
});
