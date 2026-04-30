import { describe, expect, it } from "vitest";

describe("response", () => {
	it("can be imported", async () => {
		const mod = await import("./response");
		expect(mod).toBeDefined();
	});
});
