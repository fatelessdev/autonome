import { describe, it, expect } from "vitest";

describe("leaderboard", () => {
	it("can be imported", async () => {
		const mod = await import("./leaderboard");
		expect(mod).toBeDefined();
	});
});
