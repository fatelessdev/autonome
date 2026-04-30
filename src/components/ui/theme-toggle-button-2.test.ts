import { describe, expect, it } from "vitest";

describe("theme-toggle-button-2", () => {
	it("can be imported", async () => {
		const mod = await import("./theme-toggle-button-2");
		expect(mod).toBeDefined();
	});
});
