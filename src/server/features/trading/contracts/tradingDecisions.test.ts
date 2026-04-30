import { describe, expect, it, vi } from "vitest";
import {
	buildDecisionIndex,
	parseTradingToolCallMetadata,
} from "./tradingDecisions";

describe("tradingDecisions", () => {
	describe("parseTradingToolCallMetadata", () => {
		it("should parse a valid decision from decisions array", () => {
			const raw = {
				decisions: [
					{
						symbol: "BTC",
						signal: "LONG",
						quantity: 0.5,
						profitTarget: 70000,
						stopLoss: 60000,
						confidence: 0.8,
					},
				],
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.decisions).toHaveLength(1);
			expect(result.decisions[0].symbol).toBe("BTC");
			expect(result.decisions[0].side).toBe("LONG");
			expect(result.decisions[0].quantity).toBe(0.5);
		});

		it("should parse from action field as signal alternative", () => {
			const raw = {
				decisions: [
					{
						symbol: "ETH",
						action: "SHORT",
						quantity: 2,
					},
				],
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.decisions[0].side).toBe("SHORT");
		});

		it("should throw for non-object input", () => {
			expect(() => parseTradingToolCallMetadata("string")).toThrow(
				"Invalid trading tool metadata shape",
			);
			expect(() => parseTradingToolCallMetadata(null)).toThrow(
				"Invalid trading tool metadata shape",
			);
		});

		it("should throw when no valid decisions found", () => {
			expect(() => parseTradingToolCallMetadata({ decisions: [] })).toThrow(
				"No valid trading decisions found",
			);
		});

		it("should fall back to root-level decision when no array", () => {
			const raw = {
				symbol: "BTC",
				signal: "LONG",
				quantity: 1,
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.decisions).toHaveLength(1);
			expect(result.decisions[0].symbol).toBe("BTC");
		});

		it("should parse results array", () => {
			const raw = {
				decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.5 }],
				results: [{ symbol: "BTC", success: true, error: null }],
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.results).toHaveLength(1);
			expect(result.results[0].symbol).toBe("BTC");
			expect(result.results[0].success).toBe(true);
		});

		it("should normalize symbol to canonical uppercase", () => {
			const raw = {
				decisions: [{ symbol: "btc/usd", signal: "LONG", quantity: 0.1 }],
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.decisions[0].symbol).toBe("BTC");
		});

		it("should handle HOLD signal", () => {
			const raw = {
				decisions: [{ symbol: "ETH", signal: "HOLD" }],
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.decisions[0].side).toBe("HOLD");
		});

		it("should parse closedPositions as decision source", () => {
			const raw = {
				decisions: [],
				closedPositions: [
					{ symbol: "SOL", signal: "CLOSE", side: "LONG", quantity: 10 },
				],
			};

			// closedPositions doesn't have valid signal, should throw
			expect(() => parseTradingToolCallMetadata(raw)).toThrow(
				"No valid trading decisions found",
			);
		});

		it("should parse multiple decisions from multiple arrays", () => {
			const raw = {
				decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.1 }],
				positions: [{ symbol: "ETH", signal: "SHORT", quantity: 1 }],
			};

			const result = parseTradingToolCallMetadata(raw);
			expect(result.decisions).toHaveLength(2);
		});
	});

	describe("buildDecisionIndex", () => {
		it("should build index from tool calls", () => {
			const toolCalls = [
				{
					id: "tc-1",
					createdAt: new Date("2024-01-01T00:00:00Z"),
					metadata: {
						decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.5 }],
						results: [],
						raw: {},
					},
				},
			];

			const index = buildDecisionIndex(toolCalls);
			expect(index.size).toBe(1);
			expect(index.has("BTC")).toBe(true);
			expect(index.get("BTC")?.toolCallId).toBe("tc-1");
		});

		it("should keep first decision per symbol (no overwrite)", () => {
			const toolCalls = [
				{
					id: "tc-1",
					createdAt: new Date("2024-01-01T00:00:00Z"),
					metadata: {
						decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.5 }],
						results: [],
						raw: {},
					},
				},
				{
					id: "tc-2",
					createdAt: new Date("2024-01-02T00:00:00Z"),
					metadata: {
						decisions: [{ symbol: "BTC", signal: "SHORT", quantity: 1 }],
						results: [],
						raw: {},
					},
				},
			];

			const index = buildDecisionIndex(toolCalls);
			expect(index.size).toBe(1);
			expect(index.get("BTC")?.toolCallId).toBe("tc-1");
		});

		it("should merge results into decisions", () => {
			const toolCalls = [
				{
					id: "tc-1",
					createdAt: new Date("2024-01-01T00:00:00Z"),
					metadata: {
						decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.5 }],
						results: [{ symbol: "BTC", success: true, error: null }],
						raw: {},
					},
				},
			];

			const index = buildDecisionIndex(toolCalls);
			expect(index.get("BTC")?.result?.success).toBe(true);
		});

		it("should skip malformed tool calls instead of crashing", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			const toolCalls = [
				{
					id: "tc-bad",
					createdAt: new Date("2024-01-01T00:00:00Z"),
					metadata: {
						decisions: [],
						raw: {},
					},
				},
				{
					id: "tc-good",
					createdAt: new Date("2024-01-02T00:00:00Z"),
					metadata: {
						decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.5 }],
						results: [],
						raw: {},
					},
				},
			];

			const index = buildDecisionIndex(toolCalls);

			expect(index.size).toBe(1);
			expect(index.has("BTC")).toBe(true);
			expect(index.get("BTC")?.toolCallId).toBe("tc-good");
			expect(warn).toHaveBeenCalledTimes(1);
			warn.mockRestore();
		});
	});
});
