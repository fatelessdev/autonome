import { describe, it, expect } from "vitest";

describe("command", () => {
	it("can be imported", async () => {
		const mod = await import("./command");
		expect(mod).toBeDefined();
	});
});
