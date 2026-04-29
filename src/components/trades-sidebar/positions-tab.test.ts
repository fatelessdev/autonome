import { describe, it, expect } from "vitest";

describe("positions-tab", () => {
	it("can be imported", async () => {
		const mod = await import("./positions-tab");
		expect(mod).toBeDefined();
	});
});
