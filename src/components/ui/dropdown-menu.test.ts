import { describe, expect, it } from "vitest";

describe("dropdown-menu", () => {
	it("can be imported", async () => {
		const mod = await import("./dropdown-menu");
		expect(mod).toBeDefined();
	});
});
