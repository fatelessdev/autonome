import { describe, it, expect } from "vitest";

describe("portfolio", () => {
	it("can be imported", async () => {
		const mod = await import("./portfolio");
		expect(mod).toBeDefined();
	});
});
