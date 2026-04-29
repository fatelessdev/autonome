import { describe, it, expect } from "vitest";
import { emitWorkflowEvent, emitWorkflowComplete, emitBatchComplete, emitPositionsChanged, emitTradesChanged } from "./workflowEvents";

describe("workflowEvents", () => {
	it("exports expected members", () => {
		expect(emitWorkflowEvent).toBeDefined();
		expect(emitWorkflowComplete).toBeDefined();
		expect(emitBatchComplete).toBeDefined();
		expect(emitPositionsChanged).toBeDefined();
		expect(emitTradesChanged).toBeDefined();
	});
});
