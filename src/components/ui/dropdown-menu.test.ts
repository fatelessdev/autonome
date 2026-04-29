import { describe, it, expect } from "vitest";

describe("dropdown-menu", () => {
	it("can be imported", async () => {
		const mod = await import("./dropdown-menu");
		expect(mod).toBeDefined();
	});
});
