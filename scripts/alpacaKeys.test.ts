import { describe, it, expect } from "vitest";

describe("alpacaKeys", () => {
	it("can be imported", async () => {
		const mod = await import("./alpacaKeys");
		expect(mod).toBeDefined();
	});
});
