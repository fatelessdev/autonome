import { describe, expect, it } from "vitest";

describe("glowing-line", () => {
	it("can be imported", async () => {
		const mod = await import("./glowing-line");
		expect(mod).toBeDefined();
	});
});
