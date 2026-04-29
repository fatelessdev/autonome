import { describe, it, expect } from "vitest";

describe("closePosition", () => {
	it("can be imported", async () => {
		const mod = await import("./closePosition");
		expect(mod).toBeDefined();
	});
});
