import { describe, it, expect } from "vitest";

describe("header", () => {
	it("can be imported", async () => {
		const mod = await import("./header");
		expect(mod).toBeDefined();
	});
});
