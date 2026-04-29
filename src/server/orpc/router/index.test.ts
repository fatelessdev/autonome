import { describe, it, expect } from "vitest";

describe("index", () => {
	it("can be imported", { timeout: 30000 }, async () => {
		const mod = await import("./index");
		expect(mod).toBeDefined();
	});
});
