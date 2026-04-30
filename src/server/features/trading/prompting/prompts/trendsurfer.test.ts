import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, USER_PROMPT } from "./trendsurfer";

describe("trendsurfer", () => {
	it("exports expected members", () => {
		expect(SYSTEM_PROMPT).toBeDefined();
		expect(USER_PROMPT).toBeDefined();
	});

	it("contains tool reference section", () => {
		expect(SYSTEM_PROMPT).toContain("TOOL REFERENCE");
		expect(SYSTEM_PROMPT).toContain("createPosition");
		expect(SYSTEM_PROMPT).toContain("closePosition");
		expect(SYSTEM_PROMPT).toContain("holding");
		expect(SYSTEM_PROMPT).toContain("stop_loss");
		expect(SYSTEM_PROMPT).toContain("profit_target");
		expect(SYSTEM_PROMPT).toContain("quantity");
		expect(SYSTEM_PROMPT).toContain("Minimum trade notional");
	});

	it("contains fee awareness section", () => {
		expect(SYSTEM_PROMPT).toContain("FEE & SLIPPAGE AWARENESS");
		expect(SYSTEM_PROMPT).toContain("round-trip cost");
		expect(SYSTEM_PROMPT).toContain("~0.1-0.3%");
		expect(SYSTEM_PROMPT).toContain("profit targets MUST exceed fee drag");
	});
});
