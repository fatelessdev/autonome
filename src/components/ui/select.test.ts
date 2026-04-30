import { describe, expect, it } from "vitest";

describe("select", () => {
	it("can be imported", async () => {
		const mod = await import("./select");
		expect(mod).toBeDefined();
	});
});
