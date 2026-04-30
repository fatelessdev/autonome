import { describe, expect, it } from "vitest";
import { getInvocations, getModels } from "./models";

describe("models", () => {
	it("exports expected members", () => {
		expect(getModels).toBeDefined();
		expect(getInvocations).toBeDefined();
	});
});
