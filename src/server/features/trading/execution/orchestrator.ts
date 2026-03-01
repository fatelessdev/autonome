/**
 * Orchestrator Module Exports
 * Multi-model coordination patterns for enhanced trading decisions
 */

export {
	buildConsensusConfigFromVoterModels,
	CONSENSUS_MODEL_NAME,
	type ConsensusConfig,
	type ConsensusPreparationResult,
	type ConsensusResult,
	type ConsensusVoter,
	DEFAULT_CONSENSUS_CONFIG,
	isConsensusModel,
	prepareConsensusWorkflowFromModels,
	runConsensusVoting,
	runConsensusWorkflow,
	type VoterDecision,
	type VoterResult,
} from "./consensusOrchestrator";
