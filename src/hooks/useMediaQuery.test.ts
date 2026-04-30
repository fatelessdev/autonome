import { describe, expect, it } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

describe("useMediaQuery", () => {
	it("exports expected members", () => {
		expect(useMediaQuery).toBeDefined();
	});
});
