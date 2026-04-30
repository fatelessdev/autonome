import { describe, expect, it } from "vitest";
import { parseConversationToolCallMetadata } from "./conversationsSnapshot.server";

describe("conversationsSnapshot.server", () => {
	it("can be imported", async () => {
		const mod = await import("./conversationsSnapshot.server");
		expect(mod).toBeDefined();
	});

	it("skips trading decision parsing for non-decision tool calls", () => {
		const result = parseConversationToolCallMetadata({
			id: "tc-hold-1",
			toolCallType: "HOLDING",
			metadata: JSON.stringify({
				action: "holding",
				reason: "Market is choppy",
				timestamp: "2026-04-30T00:00:00.000Z",
			}),
		});

		expect(result.raw).toMatchObject({
			action: "holding",
			reason: "Market is choppy",
		});
		expect(result.decisions).toHaveLength(0);
		expect(result.results).toHaveLength(0);
	});

	it("parses decision metadata for create position tool calls", () => {
		const result = parseConversationToolCallMetadata({
			id: "tc-create-1",
			toolCallType: "CREATE_POSITION",
			metadata: JSON.stringify({
				decisions: [{ symbol: "BTC", signal: "LONG", quantity: 0.5 }],
				results: [{ symbol: "BTC", success: true }],
			}),
		});

		expect(result.decisions).toHaveLength(1);
		expect(result.decisions[0].symbol).toBe("BTC");
		expect(result.results).toHaveLength(1);
		expect(result.results[0].symbol).toBe("BTC");
	});
});
