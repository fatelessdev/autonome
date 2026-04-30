import { describe, expect, it } from "vitest";

describe("chat", () => {
	it("can be imported", async () => {
		const mod = await import("./chat");
		expect(mod).toBeDefined();
	});
});
