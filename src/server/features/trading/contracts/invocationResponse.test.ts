import { describe, expect, it } from "vitest";
import { buildInvocationResponsePayload } from "./invocationResponse";

describe("invocationResponse", () => {
	describe("buildInvocationResponsePayload", () => {
		it("should build payload with null result", () => {
			const payload = buildInvocationResponsePayload({
				prompt: "test prompt",
				result: null,
				decisions: [],
				executionResults: [],
				closedPositions: [],
			});

			expect(payload.prompt).toBe("test prompt");
			expect(payload.finishReason).toBeNull();
			expect(payload.usage).toBeNull();
			expect(payload.warnings).toBeNull();
			expect(payload.providerResponse).toBeNull();
			expect(payload.decisions).toEqual([]);
			expect(payload.executionResults).toEqual([]);
			expect(payload.closedPositions).toEqual([]);
		});

		it("should extract finishReason and usage from result", () => {
			const payload = buildInvocationResponsePayload({
				prompt: "test",
				result: {
					finishReason: "stop",
					usage: { promptTokens: 100, completionTokens: 50 },
				},
				decisions: [],
				executionResults: [],
				closedPositions: [],
			});

			expect(payload.finishReason).toBe("stop");
			expect(payload.usage).toEqual({
				promptTokens: 100,
				completionTokens: 50,
			});
		});

		it("should extract provider response with string timestamp", () => {
			const payload = buildInvocationResponsePayload({
				prompt: "test",
				result: {
					response: {
						id: "resp-123",
						modelId: "model-456",
						timestamp: "2024-01-01T00:00:00Z",
					},
				},
				decisions: [],
				executionResults: [],
				closedPositions: [],
			});

			expect(payload.providerResponse).toEqual({
				id: "resp-123",
				modelId: "model-456",
				timestamp: "2024-01-01T00:00:00Z",
			});
		});

		it("should convert Date timestamp to ISO string", () => {
			const date = new Date("2024-06-15T12:00:00Z");
			const payload = buildInvocationResponsePayload({
				prompt: "test",
				result: {
					response: {
						id: "resp-1",
						modelId: "model-1",
						timestamp: date,
					},
				},
				decisions: [],
				executionResults: [],
				closedPositions: [],
			});

			expect(payload.providerResponse?.timestamp).toBe(
				"2024-06-15T12:00:00.000Z",
			);
		});

		it("should include decisions and execution results", () => {
			const decisions = [
				{
					symbol: "BTC",
					side: "LONG" as const,
					quantity: 0.5,
					profitTarget: 70000,
					stopLoss: 60000,
					invalidationCondition: null,
					invalidationPrice: null,
					timeExit: null,
					cooldownUntil: null,
					confidence: 0.8,
				},
			];
			const executionResults = [
				{
					symbol: "BTC",
					side: "LONG" as const,
					quantity: 0.5,
					success: true,
					error: null,
				},
			];

			const payload = buildInvocationResponsePayload({
				prompt: "trade BTC",
				result: null,
				decisions,
				executionResults,
				closedPositions: [],
			});

			expect(payload.decisions).toHaveLength(1);
			expect(payload.decisions[0].symbol).toBe("BTC");
			expect(payload.executionResults).toHaveLength(1);
			expect(payload.executionResults[0].success).toBe(true);
		});

		it("should aggregate step telemetry", () => {
			const stepTelemetry = [
				{
					stepNumber: 1,
					toolNames: ["create_position"],
					inputTokens: 1000,
					outputTokens: 200,
					totalTokens: 1200,
					timestamp: "2024-01-01T00:00:00Z",
				},
				{
					stepNumber: 2,
					toolNames: ["close_position"],
					inputTokens: 500,
					outputTokens: 100,
					totalTokens: 600,
					timestamp: "2024-01-01T00:01:00Z",
				},
			];

			const payload = buildInvocationResponsePayload({
				prompt: "test",
				result: null,
				decisions: [],
				executionResults: [],
				closedPositions: [],
				stepTelemetry,
			});

			expect(payload.totalSteps).toBe(2);
			expect(payload.totalInputTokens).toBe(1500);
			expect(payload.totalOutputTokens).toBe(300);
		});

		it("should handle non-object result by throwing", () => {
			expect(() =>
				buildInvocationResponsePayload({
					prompt: "test",
					result: "invalid-string",
					decisions: [],
					executionResults: [],
					closedPositions: [],
				}),
			).toThrow("Invalid invocation result payload shape");
		});

		it("should handle array result by throwing", () => {
			expect(() =>
				buildInvocationResponsePayload({
					prompt: "test",
					result: [1, 2, 3],
					decisions: [],
					executionResults: [],
					closedPositions: [],
				}),
			).toThrow("Invalid invocation result payload shape");
		});
	});
});
