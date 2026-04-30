import { describe, expect, it } from "vitest";

describe("header", () => {
	it("can be imported", async () => {
		const mod = await import("./header");
		expect(mod).toBeDefined();
	});
});
