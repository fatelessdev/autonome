import { describe, expect, it } from "vitest";

describe("leaderboard", () => {
	it("can be imported", async () => {
		const mod = await import("./leaderboard");
		expect(mod).toBeDefined();
	});
});
