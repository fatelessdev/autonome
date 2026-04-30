import { describe, expect, it } from "vitest";

describe("command", () => {
	it("can be imported", async () => {
		const mod = await import("./command");
		expect(mod).toBeDefined();
	});
});
