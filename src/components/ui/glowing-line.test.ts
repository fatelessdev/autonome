import { describe, it, expect } from "vitest";

describe("glowing-line", () => {
	it("can be imported", async () => {
		const mod = await import("./glowing-line");
		expect(mod).toBeDefined();
	});
});
