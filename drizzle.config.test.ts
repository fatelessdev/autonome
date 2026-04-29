import { describe, it, expect } from "vitest";

describe("drizzle.config", () => {
	it("can be imported", async () => {
		const mod = await import("./drizzle.config");
		expect(mod).toBeDefined();
	});
});
