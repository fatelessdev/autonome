import { describe, it, expect } from "vitest";
import { useBoolean } from "./useBoolean";

describe("useBoolean", () => {
	it("exports expected members", () => {
		expect(useBoolean).toBeDefined();
	});
});
