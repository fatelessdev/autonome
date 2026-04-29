import { describe, it, expect } from "vitest";

describe("sonner", () => {
	it("can be imported", async () => {
		const mod = await import("./sonner");
		expect(mod).toBeDefined();
	});
});
