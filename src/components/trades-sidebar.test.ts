import { describe, it, expect } from "vitest";

describe("trades-sidebar", () => {
	it("can be imported", async () => {
		const mod = await import("./trades-sidebar");
		expect(mod).toBeDefined();
	});
});
