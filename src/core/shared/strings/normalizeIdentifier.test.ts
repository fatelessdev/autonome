import { describe, expect, it } from "vitest";
import { normalizeIdentifier } from "./normalizeIdentifier";

describe("normalizeIdentifier", () => {
	it("exports expected members", () => {
		expect(normalizeIdentifier).toBeDefined();
	});
});
