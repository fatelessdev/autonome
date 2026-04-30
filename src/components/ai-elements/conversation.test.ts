import { describe, expect, it } from "vitest";

describe("conversation", () => {
	it("can be imported", async () => {
		const mod = await import("./conversation");
		expect(mod).toBeDefined();
	});
});
