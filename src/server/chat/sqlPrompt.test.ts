import { describe, expect, it } from "vitest";

describe("sqlPrompt", () => {
	it("can be imported", async () => {
		const mod = await import("./sqlPrompt");
		expect(mod).toBeDefined();
	});
});
