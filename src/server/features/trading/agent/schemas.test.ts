import { describe, expect, it } from "vitest";
import {
	agentOutputSchema,
	callOptionsSchema,
	decisionSchema,
} from "./schemas";

describe("schemas", () => {
	describe("decisionSchema", () => {
		it("validates a complete BUY decision", () => {
			const result = decisionSchema.safeParse({
				symbol: "BTC",
				side: "LONG",
				quantity: 0.5,
				profit_target: 70000,
				stop_loss: 60000,
				invalidation_condition: "4h close below EMA50",
				invalidation_price: 58000,
				time_exit: "Close if held >24h",
				cooldown_minutes: 10,
				confidence: 80,
			});

			expect(result.success).toBe(true);
		});

		it("validates a HOLD decision", () => {
			const result = decisionSchema.safeParse({
				symbol: "BTC",
				side: "HOLD",
				quantity: 0.01,
				profit_target: 1,
				stop_loss: 1,
				invalidation_condition: "none",
				confidence: 0,
			});

			expect(result.success).toBe(true);
		});

		it("rejects invalid side values", () => {
			const result = decisionSchema.safeParse({
				symbol: "BTC",
				side: "INVALID",
				quantity: 0.5,
				profit_target: 70000,
				stop_loss: 60000,
				invalidation_condition: "test",
				confidence: 50,
			});

			expect(result.success).toBe(false);
		});

		it("rejects negative quantity", () => {
			const result = decisionSchema.safeParse({
				symbol: "BTC",
				side: "LONG",
				quantity: -1,
				profit_target: 70000,
				stop_loss: 60000,
				invalidation_condition: "test",
				confidence: 50,
			});

			expect(result.success).toBe(false);
		});

		it("rejects confidence above 100", () => {
			const result = decisionSchema.safeParse({
				symbol: "BTC",
				side: "LONG",
				quantity: 0.5,
				profit_target: 70000,
				stop_loss: 60000,
				invalidation_condition: "test",
				confidence: 150,
			});

			expect(result.success).toBe(false);
		});

		it("allows optional fields to be absent", () => {
			const result = decisionSchema.safeParse({
				symbol: "ETH",
				side: "SHORT",
				quantity: 1,
				profit_target: 2500,
				stop_loss: 3500,
				invalidation_condition: "break above resistance",
				confidence: 70,
			});

			expect(result.success).toBe(true);
		});
	});

	describe("agentOutputSchema", () => {
		it("validates trading output", () => {
			const result = agentOutputSchema.safeParse({
				status: "trading",
				summary: "Opened long BTC position",
				actionsCount: 1,
			});

			expect(result.success).toBe(true);
		});

		it("validates holding output", () => {
			const result = agentOutputSchema.safeParse({
				status: "holding",
				summary: "Market conditions unclear",
				actionsCount: 0,
			});

			expect(result.success).toBe(true);
		});

		it("rejects invalid status", () => {
			const result = agentOutputSchema.safeParse({
				status: "invalid",
				summary: "test",
				actionsCount: 0,
			});

			expect(result.success).toBe(false);
		});
	});

	describe("callOptionsSchema", () => {
		it("validates with all fields", () => {
			const result = callOptionsSchema.safeParse({
				maxSteps: 5,
				reasoningEffort: "high",
			});

			expect(result.success).toBe(true);
		});

		it("validates with no fields", () => {
			const result = callOptionsSchema.safeParse({});
			expect(result.success).toBe(true);
		});

		it("rejects invalid reasoning effort", () => {
			const result = callOptionsSchema.safeParse({
				reasoningEffort: "extreme",
			});

			expect(result.success).toBe(false);
		});

		it("validates each reasoning effort level", () => {
			for (const level of ["low", "medium", "high"]) {
				const result = callOptionsSchema.safeParse({
					reasoningEffort: level,
				});
				expect(result.success).toBe(true);
			}
		});
	});
});
