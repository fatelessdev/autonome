import { describe, expect, it } from "vitest";

describe("badge", () => {
	it("can be imported", async () => {
		const mod = await import("./badge");
		expect(mod).toBeDefined();
	});
});
