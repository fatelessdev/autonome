import { describe, it, expect } from "vitest";

describe("model-chat-tab", () => {
	it("can be imported", async () => {
		const mod = await import("./model-chat-tab");
		expect(mod).toBeDefined();
	});
});
