import { describe, it, expect } from "vitest";

describe("response", () => {
	it("can be imported", async () => {
		const mod = await import("./response");
		expect(mod).toBeDefined();
	});
});
