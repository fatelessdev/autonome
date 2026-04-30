import { describe, expect, it } from "vitest";

describe("router", () => {
	it("can be imported", { timeout: 30000 }, async () => {
		const mod = await import("./router");
		expect(mod).toBeDefined();
	});
});
