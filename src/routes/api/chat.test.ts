import { describe, it, expect } from "vitest";

describe("chat", () => {
	it("can be imported", async () => {
		const mod = await import("./chat");
		expect(mod).toBeDefined();
	});
});
