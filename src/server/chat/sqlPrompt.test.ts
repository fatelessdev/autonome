import { describe, it, expect } from "vitest";

describe("sqlPrompt", () => {
	it("can be imported", async () => {
		const mod = await import("./sqlPrompt");
		expect(mod).toBeDefined();
	});
});
