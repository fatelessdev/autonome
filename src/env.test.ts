import { describe, it, expect } from "vitest";

describe("env", () => {
	it("can be imported", async () => {
		const mod = await import("./env");
		expect(mod).toBeDefined();
	});
});
