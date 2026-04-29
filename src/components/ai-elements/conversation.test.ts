import { describe, it, expect } from "vitest";

describe("conversation", () => {
	it("can be imported", async () => {
		const mod = await import("./conversation");
		expect(mod).toBeDefined();
	});
});
