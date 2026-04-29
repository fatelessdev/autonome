import { describe, it, expect } from "vitest";

describe("root-provider", () => {
	it("can be imported", async () => {
		const mod = await import("./root-provider");
		expect(mod).toBeDefined();
	});
});
