/**
 * Orchestrator Module Exports
 * Multi-model coordination patterns for enhanced trading decisions
 */

export {
	CONSENSUS_MODEL_NAME,
	type ConsensusConfig,
	type ConsensusResult,
	type ConsensusVoter,
	DEFAULT_CONSENSUS_CONFIG,
	runConsensusVoting,
	runConsensusWorkflow,
	type VoterDecision,
	type VoterResult,
} from "./consensusOrchestrator";
