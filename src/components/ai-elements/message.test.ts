import { describe, expect, it } from "vitest";

describe("message", () => {
	it("can be imported", async () => {
		const mod = await import("./message");
		expect(mod).toBeDefined();
	});
});
