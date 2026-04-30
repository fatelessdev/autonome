import { describe, expect, it } from "vitest";
import {
	emitBatchComplete,
	emitPositionsChanged,
	emitTradesChanged,
	emitWorkflowComplete,
	emitWorkflowEvent,
} from "./workflowEvents";

describe("workflowEvents", () => {
	it("exports expected members", () => {
		expect(emitWorkflowEvent).toBeDefined();
		expect(emitWorkflowComplete).toBeDefined();
		expect(emitBatchComplete).toBeDefined();
		expect(emitPositionsChanged).toBeDefined();
		expect(emitTradesChanged).toBeDefined();
	});
});
