import { describe, it, expect } from "vitest";
import { getModels, getInvocations } from "./models";

describe("models", () => {
	it("exports expected members", () => {
		expect(getModels).toBeDefined();
		expect(getInvocations).toBeDefined();
	});
});
