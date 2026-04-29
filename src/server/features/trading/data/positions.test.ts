import { describe, it, expect } from "vitest";

describe("positions", () => {
	it("can be imported", async () => {
		const mod = await import("./positions");
		expect(mod).toBeDefined();
	});
});
