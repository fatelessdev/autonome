import { describe, it, expect } from "vitest";
import { normalizeIdentifier } from "./normalizeIdentifier";

describe("normalizeIdentifier", () => {
	it("exports expected members", () => {
		expect(normalizeIdentifier).toBeDefined();
	});
});
