import { describe, it, expect } from "vitest";

describe("message", () => {
	it("can be imported", async () => {
		const mod = await import("./message");
		expect(mod).toBeDefined();
	});
});
