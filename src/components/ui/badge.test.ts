import { describe, it, expect } from "vitest";

describe("badge", () => {
	it("can be imported", async () => {
		const mod = await import("./badge");
		expect(mod).toBeDefined();
	});
});
