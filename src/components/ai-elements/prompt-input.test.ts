import { describe, it, expect } from "vitest";

describe("prompt-input", () => {
	it("can be imported", async () => {
		const mod = await import("./prompt-input");
		expect(mod).toBeDefined();
	});
});
