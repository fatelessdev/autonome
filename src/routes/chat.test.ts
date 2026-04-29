import { describe, it, expect } from "vitest";

describe("chat", () => {
	it("can be imported", { timeout: 15000 }, async () => {
		const mod = await import("./chat");
		expect(mod).toBeDefined();
	});
});
