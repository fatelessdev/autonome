/**
 * Consensus Voting - Pure voting/aggregation logic for consensus decisions
 *
 * Separated from the orchestrator to isolate deterministic aggregation
 * from orchestration, provider setup, and workflow concerns.
 */

import { z } from "zod";

// ==================== Types ====================

export interface ConsensusVoter {
	modelId: string;
	name: string;
	routerModelName: string;
	weight: number; // 0-1, higher = more influence
}

export interface ConsensusConfig {
	voters: ConsensusVoter[];
	minAgreement: number; // Minimum voters that must agree (e.g., 2 for 2/3)
	confidenceThreshold: number; // 0-10, minimum avg confidence to execute
	timeoutMs: number;
}

export interface VoterDecision {
	action: "BUY" | "SELL" | "HOLD";
	symbol: string | null;
	side: "LONG" | "SHORT" | null;
	confidence: number; // 0-10
	quantity: number | null;
	leverage: number | null;
	stopLoss: number | null;
	takeProfit: number | null;
	reasoning: string;
}

export interface VoterResult {
	voterId: string;
	voterName: string;
	decision: VoterDecision;
	latencyMs: number;
	error?: string;
}

export interface ConsensusResult {
	consensus: "BUY" | "SELL" | "HOLD";
	symbol: string | null;
	side: "LONG" | "SHORT" | null;
	agreementCount: number;
	totalVoters: number;
	averageConfidence: number;
	weightedConfidence: number;
	shouldExecute: boolean;
	executionParams: {
		quantity: number;
		leverage: number;
		stopLoss: number | null;
		takeProfit: number | null;
	} | null;
	voterResults: VoterResult[];
	reasoning: string;
}

// ==================== Schema ====================

export const voterDecisionSchema = z.object({
	action: z
		.enum(["BUY", "SELL", "HOLD"])
		.describe(
			"Trading action: BUY to open long, SELL to open short, HOLD for no action",
		),
	symbol: z
		.string()
		.nullable()
		.describe("Symbol to trade (e.g., BTC, ETH, SOL). Null if HOLD"),
	side: z
		.enum(["LONG", "SHORT"])
		.nullable()
		.describe("Position direction. Null if HOLD"),
	confidence: z
		.number()
		.min(0)
		.max(10)
		.describe(
			"Confidence in this decision (0=no confidence, 10=extremely confident)",
		),
	quantity: z
		.number()
		.nullable()
		.describe("Position size in base asset units. Null if HOLD"),
	leverage: z
		.number()
		.min(1)
		.max(10)
		.nullable()
		.describe("Leverage 1-10x. Null if HOLD"),
	stopLoss: z
		.number()
		.nullable()
		.describe("Stop loss price level. Null if HOLD"),
	takeProfit: z
		.number()
		.nullable()
		.describe("Take profit price level. Null if HOLD"),
	reasoning: z.string().describe("Brief explanation of the decision rationale"),
});

// ==================== Pure Helpers ====================

export const toErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const buildFailedVoterResult = (
	voterId: string,
	voterName: string,
	error: unknown,
	latencyMs: number,
): VoterResult => {
	const message = toErrorMessage(error);
	return {
		voterId,
		voterName,
		decision: {
			action: "HOLD",
			symbol: null,
			side: null,
			confidence: 0,
			quantity: null,
			leverage: null,
			stopLoss: null,
			takeProfit: null,
			reasoning: `Error: ${message}`,
		},
		latencyMs,
		error: message,
	};
};

export const getMedian = (values: number[]): number => {
	if (values.length === 0) {
		throw new Error("Cannot compute median of empty value set");
	}
	return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
};

// ==================== Vote Aggregation ====================

/**
 * Aggregate votes and determine consensus
 */
export function aggregateVotes(
	results: VoterResult[],
	config: ConsensusConfig,
): ConsensusResult {
	const validResults = results.filter((r) => !r.error);
	if (validResults.length === 0) {
		throw new Error("Consensus voting failed: all voters returned errors");
	}

	// Count votes by action
	const voteCounts = {
		BUY: validResults.filter((r) => r.decision.action === "BUY"),
		SELL: validResults.filter((r) => r.decision.action === "SELL"),
		HOLD: validResults.filter((r) => r.decision.action === "HOLD"),
	};

	// Determine winning action
	const [winningAction, winningVotes] = Object.entries(voteCounts).reduce(
		(best, [action, votes]) =>
			votes.length > best[1].length ? [action, votes] : best,
		["HOLD", [] as VoterResult[]],
	) as ["BUY" | "SELL" | "HOLD", VoterResult[]];

	const agreementCount = winningVotes.length;
	const totalVoters = validResults.length;

	// Calculate confidence metrics
	const agreeingDecisions = winningVotes.map((v) => v.decision);
	const avgConfidence =
		agreeingDecisions.length > 0
			? agreeingDecisions.reduce((sum, d) => sum + d.confidence, 0) /
				agreeingDecisions.length
			: 0;

	// Weighted confidence (using voter weights)
	const voters = config.voters;
	let weightedSum = 0;
	let weightTotal = 0;
	for (const vote of winningVotes) {
		const voter = voters.find((v) => v.modelId === vote.voterId);
		if (!voter) {
			throw new Error(
				`Missing voter configuration for result voterId=${vote.voterId}`,
			);
		}
		const weight = voter.weight;
		weightedSum += vote.decision.confidence * weight;
		weightTotal += weight;
	}
	const weightedConfidence = weightTotal > 0 ? weightedSum / weightTotal : 0;

	// Determine if we should execute
	const hasMinAgreement = agreementCount >= config.minAgreement;
	const meetsConfidenceThreshold = avgConfidence >= config.confidenceThreshold;
	const isActionable = winningAction !== "HOLD";
	const shouldExecute =
		hasMinAgreement && meetsConfidenceThreshold && isActionable;

	// Debug logging for why we're not executing
	if (!shouldExecute && isActionable) {
		console.log(
			`[Consensus] Not executing: hasMinAgreement=${hasMinAgreement} (${agreementCount}/${config.minAgreement}), ` +
				`meetsConfidence=${meetsConfidenceThreshold} (${avgConfidence.toFixed(1)}/${config.confidenceThreshold})`,
		);
	}

	// Aggregate execution parameters (median values from agreeing voters)
	let executionParams: ConsensusResult["executionParams"] = null;
	if (shouldExecute && agreeingDecisions.length > 0) {
		const quantities = agreeingDecisions
			.map((d) => d.quantity)
			.filter((q): q is number => q !== null);
		const leverages = agreeingDecisions
			.map((d) => d.leverage)
			.filter((l): l is number => l !== null);
		const stops = agreeingDecisions
			.map((d) => d.stopLoss)
			.filter((s): s is number => s !== null);
		const targets = agreeingDecisions
			.map((d) => d.takeProfit)
			.filter((t): t is number => t !== null);

		if (quantities.length === 0) {
			throw new Error(
				"Consensus marked executable but no agreeing voter provided quantity",
			);
		}
		if (leverages.length === 0) {
			throw new Error(
				"Consensus marked executable but no agreeing voter provided leverage",
			);
		}

		const medianQuantity = getMedian(quantities);
		const medianLeverage = getMedian(leverages);
		const medianStop = stops.length > 0 ? getMedian(stops) : null;
		const medianTarget = targets.length > 0 ? getMedian(targets) : null;

		executionParams = {
			quantity: medianQuantity,
			leverage: medianLeverage,
			stopLoss: medianStop,
			takeProfit: medianTarget,
		};
	}

	// Get consensus symbol (most voted symbol among agreeing decisions)
	const symbols = agreeingDecisions
		.map((d) => d.symbol)
		.filter((s): s is string => s !== null);
	const symbolCounts = new Map<string, number>();
	for (const sym of symbols) {
		symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
	}
	const consensusSymbol =
		symbols.length > 0
			? [...symbolCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
			: null;
	if (shouldExecute && !consensusSymbol) {
		throw new Error(
			"Consensus marked executable but no symbol was provided by agreeing voters",
		);
	}

	// Compile reasoning from agreeing voters
	const reasoning = winningVotes
		.map((v) => `[${v.voterName}]: ${v.decision.reasoning}`)
		.join("\n");

	return {
		consensus: winningAction,
		symbol: consensusSymbol,
		side:
			winningAction === "BUY"
				? "LONG"
				: winningAction === "SELL"
					? "SHORT"
					: null,
		agreementCount,
		totalVoters,
		averageConfidence: avgConfidence,
		weightedConfidence,
		shouldExecute,
		executionParams,
		voterResults: results,
		reasoning,
	};
}
