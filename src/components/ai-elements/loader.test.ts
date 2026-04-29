import { describe, it, expect } from "vitest";

describe("loader", () => {
	it("can be imported", async () => {
		const mod = await import("./loader");
		expect(mod).toBeDefined();
	});
});
