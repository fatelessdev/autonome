import { describe, it, expect } from "vitest";
import {
	mapPositionToEventData,
	mapTradeToEventData,
	mapConversationToEventData,
} from "./tradingEventPayloadMappers";

describe("tradingEventPayloadMappers", () => {
	describe("mapPositionToEventData", () => {
		it("maps a valid position query item to event data", () => {
			const input = {
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: "openai/gpt-4",
				positions: [{ symbol: "BTC", side: "LONG", quantity: 0.5 }],
				totalUnrealizedPnl: 150.25,
			};

			const result = mapPositionToEventData(input);

			expect(result).toEqual({
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: "openai/gpt-4",
				positions: [{ symbol: "BTC", side: "LONG", quantity: 0.5 }],
				totalUnrealizedPnl: 150.25,
			});
		});

		it("throws when modelLogo is missing", () => {
			const input = {
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: null,
				positions: [],
				totalUnrealizedPnl: 0,
			};

			expect(() => mapPositionToEventData(input)).toThrow(
				"Missing modelLogo for position event model model-1",
			);
		});

		it("throws when modelLogo is empty string", () => {
			const input = {
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: "",
				positions: [],
				totalUnrealizedPnl: 0,
			};

			expect(() => mapPositionToEventData(input)).toThrow(
				"Missing modelLogo for position event model model-1",
			);
		});

		it("handles empty positions array", () => {
			const input = {
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: "openai/gpt-4",
				positions: [],
				totalUnrealizedPnl: 0,
			};

			const result = mapPositionToEventData(input);
			expect(result.positions).toEqual([]);
		});
	});

	describe("mapTradeToEventData", () => {
		const baseTrade = {
			id: "trade-1",
			modelId: "model-1",
			modelName: "TestModel",
			modelRouterName: "openai/gpt-4",
			symbol: "BTC",
			side: "LONG",
			quantity: 0.5,
			entryPrice: 50000,
			exitPrice: 52000,
			netPnl: 1000,
			openedAt: "2025-01-01T00:00:00Z",
			closedAt: "2025-01-01T01:00:00Z",
			holdingTime: "1H",
			timestamp: "01/01, 05:30 AM",
		};

		it("maps a valid trade to event data with computed notional values", () => {
			const result = mapTradeToEventData(baseTrade);

			expect(result.id).toBe("trade-1");
			expect(result.symbol).toBe("BTC");
			expect(result.side).toBe("LONG");
			expect(result.entryNotional).toBe(25000); // 0.5 * 50000
			expect(result.exitNotional).toBe(26000); // 0.5 * 52000
			expect(result.netPnl).toBe(1000);
		});

		it("computes null entryNotional when quantity is null", () => {
			const result = mapTradeToEventData({
				...baseTrade,
				quantity: null,
			});
			expect(result.entryNotional).toBeNull();
			expect(result.exitNotional).toBeNull();
		});

		it("computes null exitNotional when exitPrice is null", () => {
			const result = mapTradeToEventData({
				...baseTrade,
				exitPrice: null,
			});
			expect(result.entryNotional).toBe(25000);
			expect(result.exitNotional).toBeNull();
		});

		it("throws when modelRouterName is missing", () => {
			expect(() =>
				mapTradeToEventData({
					...baseTrade,
					modelRouterName: null,
				}),
			).toThrow("Missing modelRouterName");
		});

		it("throws when modelRouterName is empty string", () => {
			expect(() =>
				mapTradeToEventData({
					...baseTrade,
					modelRouterName: "",
				}),
			).toThrow("Missing modelRouterName");
		});

		it("throws when side is invalid", () => {
			expect(() =>
				mapTradeToEventData({
					...baseTrade,
					side: "INVALID",
				}),
			).toThrow("Invalid trade side");
		});

		it("accepts SHORT side", () => {
			const result = mapTradeToEventData({
				...baseTrade,
				side: "SHORT",
			});
			expect(result.side).toBe("SHORT");
		});
	});

	describe("mapConversationToEventData", () => {
		it("maps conversation query item to event data", () => {
			const toolCalls = [
				{
					id: "tc-1",
					type: "createPosition",
					metadata: { raw: {}, decisions: [], results: [] },
					timestamp: "01/01, 05:30 AM",
				},
			];
			const input = {
				id: "conv-1",
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: "openai/gpt-4",
				response: "I bought BTC",
				responsePayload: { action: "BUY" },
				timestamp: "01/01, 05:30 AM",
				toolCalls,
			};

			const result = mapConversationToEventData(input);

			expect(result.id).toBe("conv-1");
			expect(result.modelId).toBe("model-1");
			expect(result.modelName).toBe("TestModel");
			expect(result.modelLogo).toBe("openai/gpt-4");
			expect(result.response).toBe("I bought BTC");
			expect(result.responsePayload).toEqual({ action: "BUY" });
			expect(result.timestamp).toBe("01/01, 05:30 AM");
			expect(result.toolCalls).toEqual(toolCalls);
		});

		it("handles null response", () => {
			const input = {
				id: "conv-1",
				modelId: "model-1",
				modelName: "TestModel",
				modelLogo: "openai/gpt-4",
				response: null,
				responsePayload: null,
				timestamp: "01/01, 05:30 AM",
				toolCalls: [],
			};

			const result = mapConversationToEventData(input);
			expect(result.response).toBeNull();
			expect(result.responsePayload).toBeNull();
		});
	});
});
