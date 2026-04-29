import { describe, it, expect } from "vitest";
import {
	isConsensusModel,
	CONSENSUS_MODEL_NAME,
	DEFAULT_CONSENSUS_CONFIG,
} from "./consensusOrchestrator";

// Access module internals via dynamic import to test pure functions
// that are not exported (getMedian, aggregateVotes, etc.)
// We'll test the exported functions and infer behavior from defaults.

describe("consensusOrchestrator", () => {
	describe("isConsensusModel", () => {
		it("returns true for exact consensus name", () => {
			expect(isConsensusModel("consensus-orchestrator")).toBe(true);
		});

		it("is case-insensitive", () => {
			expect(isConsensusModel("Consensus-Orchestrator")).toBe(true);
			expect(isConsensusModel("CONSENSUS-ORCHESTRATOR")).toBe(true);
		});

		it("trims whitespace", () => {
			expect(isConsensusModel(" consensus-orchestrator ")).toBe(true);
		});

		it("returns false for other model names", () => {
			expect(isConsensusModel("gpt-4")).toBe(false);
			expect(isConsensusModel("claude-3")).toBe(false);
			expect(isConsensusModel("consensus")).toBe(false);
			expect(isConsensusModel("")).toBe(false);
		});
	});

	describe("CONSENSUS_MODEL_NAME", () => {
		it("is consensus-orchestrator", () => {
			expect(CONSENSUS_MODEL_NAME).toBe("consensus-orchestrator");
		});
	});

	describe("DEFAULT_CONSENSUS_CONFIG", () => {
		it("has a single voter", () => {
			expect(DEFAULT_CONSENSUS_CONFIG.voters).toHaveLength(1);
		});

		it("voter has weight 1.0", () => {
			expect(DEFAULT_CONSENSUS_CONFIG.voters[0].weight).toBe(1.0);
		});

		it("min agreement is 1", () => {
			expect(DEFAULT_CONSENSUS_CONFIG.minAgreement).toBe(1);
		});

		it("confidence threshold is 6", () => {
			expect(DEFAULT_CONSENSUS_CONFIG.confidenceThreshold).toBe(6);
		});

		it("timeout is 60 seconds", () => {
			expect(DEFAULT_CONSENSUS_CONFIG.timeoutMs).toBe(60_000);
		});
	});
});
