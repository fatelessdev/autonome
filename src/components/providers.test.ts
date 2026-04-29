import { describe, it, expect } from "vitest";

describe("providers", () => {
	it("can be imported", async () => {
		const mod = await import("./providers");
		expect(mod).toBeDefined();
	});
});
