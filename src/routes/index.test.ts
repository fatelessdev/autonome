import { describe, expect, it } from "vitest";

describe("index", () => {
	it("can be imported", { timeout: 15000 }, async () => {
		const mod = await import("./index");
		expect(mod).toBeDefined();
	});
});
