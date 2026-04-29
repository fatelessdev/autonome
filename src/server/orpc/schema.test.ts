import { describe, expect, it } from "vitest";
import {
	AccountPositionsSchema,
	CryptoPriceSchema,
	CryptoPricesInputSchema,
	CryptoPricesResponseSchema,
	DownsampleResolutionSchema,
	ExitPlanSchema,
	InvocationSchema,
	ModelSchema,
	ModelsResponseSchema,
	PortfolioHistoryResponseSchema,
	PortfolioSnapshotSchema,
	PositionSchema,
	TodoSchema,
	TradeSchema,
} from "./schema";

describe("oRPC schemas", () => {
	describe("TodoSchema", () => {
		it("should validate valid todo", () => {
			const result = TodoSchema.parse({ id: 1, name: "Test" });
			expect(result).toEqual({ id: 1, name: "Test" });
		});

		it("should reject non-integer id", () => {
			expect(() => TodoSchema.parse({ id: 1.5, name: "Test" })).toThrow();
		});

		it("should reject id < 1", () => {
			expect(() => TodoSchema.parse({ id: 0, name: "Test" })).toThrow();
		});

		it("should reject missing fields", () => {
			expect(() => TodoSchema.parse({ id: 1 })).toThrow();
			expect(() => TodoSchema.parse({ name: "Test" })).toThrow();
		});
	});

	describe("TradeSchema", () => {
		it("should validate valid trade", () => {
			const trade = {
				id: "t-1",
				modelId: "m-1",
				modelName: "GPT-4",
				side: "long",
				symbol: "BTC",
				entryPrice: 60000,
				exitPrice: 62000,
				quantity: 0.5,
				netPnl: 1000,
				openedAt: "2024-01-01",
				closedAt: "2024-01-02",
				timestamp: "2024-01-02",
			};
			expect(() => TradeSchema.parse(trade)).not.toThrow();
		});

		it("should reject invalid side", () => {
			const trade = {
				id: "t-1",
				modelId: "m-1",
				modelName: "GPT-4",
				side: "invalid",
				symbol: "BTC",
				entryPrice: 60000,
				exitPrice: 62000,
				quantity: 0.5,
				netPnl: 1000,
				openedAt: "2024-01-01",
				closedAt: "2024-01-02",
				timestamp: "2024-01-02",
			};
			expect(() => TradeSchema.parse(trade)).toThrow();
		});
	});

	describe("ExitPlanSchema", () => {
		it("should validate with all fields", () => {
			const result = ExitPlanSchema.parse({
				target: 70000,
				stop: 55000,
				invalidation: "Close if RSI < 30",
			});
			expect(result.target).toBe(70000);
		});

		it("should allow null/optional fields", () => {
			const result = ExitPlanSchema.parse({});
			expect(result.target).toBeUndefined();
			expect(result.stop).toBeUndefined();
		});

		it("should accept null values", () => {
			const result = ExitPlanSchema.parse({
				target: null,
				stop: null,
				invalidation: null,
			});
			expect(result.target).toBeNull();
		});
	});

	describe("PositionSchema", () => {
		it("should validate valid position", () => {
			const result = PositionSchema.parse({
				symbol: "BTC",
				side: "long",
				quantity: 0.5,
				entryPrice: 60000,
			});
			expect(result.symbol).toBe("BTC");
		});

		it("should reject invalid side", () => {
			expect(() =>
				PositionSchema.parse({
					symbol: "BTC",
					side: "hold",
					quantity: 0.5,
					entryPrice: 60000,
				}),
			).toThrow();
		});

		it("should allow optional fields", () => {
			const result = PositionSchema.parse({
				symbol: "BTC",
				side: "long",
				quantity: 0.5,
				entryPrice: 60000,
				notional: 30000,
				currentPrice: 62000,
				unrealizedPnl: 1000,
				leverage: 2,
				confidence: 0.8,
			});
			expect(result.notional).toBe(30000);
			expect(result.leverage).toBe(2);
		});
	});

	describe("AccountPositionsSchema", () => {
		it("should validate valid account positions", () => {
			const result = AccountPositionsSchema.parse({
				modelId: "m-1",
				modelName: "GPT-4",
				positions: [
					{ symbol: "BTC", side: "long", quantity: 0.5, entryPrice: 60000 },
				],
			});
			expect(result.modelId).toBe("m-1");
			expect(result.positions).toHaveLength(1);
		});

		it("should allow empty positions array", () => {
			const result = AccountPositionsSchema.parse({
				modelId: "m-1",
				modelName: "GPT-4",
				positions: [],
			});
			expect(result.positions).toHaveLength(0);
		});
	});

	describe("CryptoPriceSchema", () => {
		it("should validate valid price", () => {
			const result = CryptoPriceSchema.parse({
				symbol: "BTC",
				price: 62000.50,
			});
			expect(result.symbol).toBe("BTC");
			expect(result.price).toBe(62000.5);
		});
	});

	describe("CryptoPricesInputSchema", () => {
		it("should validate with optional symbols", () => {
			const result = CryptoPricesInputSchema.parse({});
			expect(result.symbols).toBeUndefined();
		});

		it("should validate with symbols array", () => {
			const result = CryptoPricesInputSchema.parse({ symbols: ["BTC", "ETH"] });
			expect(result.symbols).toEqual(["BTC", "ETH"]);
		});
	});

	describe("CryptoPricesResponseSchema", () => {
		it("should validate valid response", () => {
			const result = CryptoPricesResponseSchema.parse({
				prices: [{ symbol: "BTC", price: 62000 }],
			});
			expect(result.prices).toHaveLength(1);
		});
	});

	describe("PortfolioSnapshotSchema", () => {
		it("should validate valid snapshot", () => {
			const result = PortfolioSnapshotSchema.parse({
				id: "snap-1",
				modelId: "m-1",
				netPortfolio: "100000",
				createdAt: "2024-01-01",
				updatedAt: "2024-01-01",
			});
			expect(result.id).toBe("snap-1");
		});

		it("should validate with optional model", () => {
			const result = PortfolioSnapshotSchema.parse({
				id: "snap-1",
				modelId: "m-1",
				netPortfolio: "100000",
				createdAt: "2024-01-01",
				updatedAt: "2024-01-01",
				model: { name: "GPT-4" },
			});
			expect(result.model?.name).toBe("GPT-4");
		});
	});

	describe("DownsampleResolutionSchema", () => {
		it("should accept valid resolutions", () => {
			for (const res of ["1m", "5m", "15m", "1h", "4h"]) {
				expect(DownsampleResolutionSchema.parse(res)).toBe(res);
			}
		});

		it("should reject invalid resolution", () => {
			expect(() => DownsampleResolutionSchema.parse("30m")).toThrow();
			expect(() => DownsampleResolutionSchema.parse("1d")).toThrow();
		});
	});

	describe("PortfolioHistoryResponseSchema", () => {
		it("should validate valid response", () => {
			const result = PortfolioHistoryResponseSchema.parse({
				history: [
					{
						id: "snap-1",
						modelId: "m-1",
						netPortfolio: "100000",
						createdAt: "2024-01-01",
						updatedAt: "2024-01-01",
					},
				],
				resolution: "1h",
			});
			expect(result.history).toHaveLength(1);
			expect(result.resolution).toBe("1h");
		});
	});

	describe("ModelSchema", () => {
		it("should validate valid model", () => {
			const result = ModelSchema.parse({ id: "m-1", name: "GPT-4" });
			expect(result).toEqual({ id: "m-1", name: "GPT-4" });
		});
	});

	describe("ModelsResponseSchema", () => {
		it("should validate with optional warning", () => {
			const result = ModelsResponseSchema.parse({
				models: [{ id: "m-1", name: "GPT-4" }],
				warning: "Some models are inactive",
			});
			expect(result.warning).toBe("Some models are inactive");
		});
	});

	describe("InvocationSchema", () => {
		it("should validate valid invocation", () => {
			const result = InvocationSchema.parse({
				id: "inv-1",
				modelId: "m-1",
				modelName: "GPT-4",
				modelLogo: "/logos/gpt4.png",
				response: "I recommend buying BTC",
				timestamp: "2024-01-01",
				toolCalls: [],
			});
			expect(result.id).toBe("inv-1");
			expect(result.toolCalls).toEqual([]);
		});

		it("should validate with null response", () => {
			const result = InvocationSchema.parse({
				id: "inv-1",
				modelId: "m-1",
				modelName: "GPT-4",
				modelLogo: "/logos/gpt4.png",
				response: null,
				timestamp: "2024-01-01",
				toolCalls: [],
			});
			expect(result.response).toBeNull();
		});
	});
});
