import { describe, it, expect } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

describe("useMediaQuery", () => {
	it("exports expected members", () => {
		expect(useMediaQuery).toBeDefined();
	});
});
