import { describe, expect, it } from "vitest";

describe("dialog", () => {
	it("can be imported", async () => {
		const mod = await import("./dialog");
		expect(mod).toBeDefined();
	});
});
