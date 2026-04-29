import { describe, it, expect } from "vitest";
import { MODEL_INFO, getModelInfo, findModelInfo, getModelProvider } from "./modelConfig";

describe("modelConfig", () => {
	it("exports expected members", () => {
		expect(MODEL_INFO).toBeDefined();
		expect(getModelInfo).toBeDefined();
		expect(findModelInfo).toBeDefined();
		expect(getModelProvider).toBeDefined();
	});

	it("resolves provider-qualified model names to registered entries", () => {
		expect(findModelInfo("stepfun-ai/step-3.5-flash")).toBe(MODEL_INFO["step-3.5-flash"]);
		expect(getModelInfo("stepfun-ai/step-3.5-flash").label).toBe("Step 3.5 Flash");
		expect(getModelProvider("stepfun-ai/step-3.5-flash")).toBe("nim");
	});
});
