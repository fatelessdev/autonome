import { describe, expect, it } from "vitest";

describe("loading-skeletons", () => {
	it("can be imported", async () => {
		const mod = await import("./loading-skeletons");
		expect(mod).toBeDefined();
	});
});
