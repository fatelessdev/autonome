import { describe, expect, it } from "vitest";

describe("health", () => {
	it("can be imported", async () => {
		const mod = await import("./health");
		expect(mod).toBeDefined();
	});
});
