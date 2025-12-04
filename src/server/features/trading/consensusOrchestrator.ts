/**
 * Consensus Orchestrator - Parallel voting across multiple AI models
 *
 * Pattern: Run 3+ models in parallel with same market data, aggregate decisions
 * via weighted voting. Only execute trades where 2/3+ models agree.
 *
 * Benefits:
 * - Reduces single-model bias
 * - Higher confidence trades
 * - Exploits diverse reasoning styles
 */

import { QueryClient } from "@tanstack/react-query";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";

import { env } from "@/env";
import { MARKETS } from "@/core/shared/markets/marketMetadata";
import { getModelProvider } from "@/core/shared/models/modelConfig";
import type { PortfolioSnapshot } from "@/server/features/trading/getPortfolio";
import type { EnrichedOpenPosition } from "@/server/features/trading/openPositionEnrichment";
import { createPosition, type PositionRequest } from "@/server/features/trading/createPosition";
import type { Account } from "@/server/features/trading/accounts";
import { formatMarketSnapshots } from "@/server/features/trading/marketData";
import { marketSnapshotsQuery } from "@/server/features/trading/marketData.server";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";
import { openPositionsQuery } from "@/server/features/trading/openPositions.server";
import { enrichOpenPositions } from "@/server/features/trading/openPositionEnrichment";
import {
	createInvocationMutation,
	incrementModelUsageMutation,
	updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import { emitAllDataChanged } from "@/server/events/workflowEvents";

// ==================== Types ====================

export interface ConsensusVoter {
	modelId: string;
	modelName: string;
	openRouterModelName: string;
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

// ==================== Schemas ====================

const voterDecisionSchema = z.object({
	action: z
		.enum(["BUY", "SELL", "HOLD"])
		.describe("Trading action: BUY to open long, SELL to open short, HOLD for no action"),
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
		.describe("Confidence in this decision (0=no confidence, 10=extremely confident)"),
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
	reasoning: z
		.string()
		.describe("Brief explanation of the decision rationale"),
});

// ==================== Provider Setup ====================

function createProviders() {
	const nim = createOpenAICompatible({
		name: "nim",
		baseURL: "https://integrate.api.nvidia.com/v1",
		headers: {
			Authorization: `Bearer ${env.NIM_API_KEY}`,
		},
	});

	const openrouter = createOpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
	});

	return { nim, openrouter };
}

// ==================== Voting Logic ====================

/**
 * Get a single voter's decision
 */
async function getVoterDecision(
	voter: ConsensusVoter,
	marketIntelligence: string,
	portfolio: PortfolioSnapshot,
	openPositions: EnrichedOpenPosition[],
): Promise<VoterResult> {
	const { nim, openrouter } = createProviders();
	const startTime = Date.now();

	try {
		const provider = getModelProvider(voter.modelName);
		const isOpenRouter = provider === "openrouter";
		const model = isOpenRouter
			? openrouter(voter.openRouterModelName)
			: nim.chatModel(voter.openRouterModelName);

		const availableSymbols = Object.keys(MARKETS).join(", ");
		const riskPerTrade = portfolio.totalValue * 0.03; // 3% risk per trade

		const prompt = `You are a systematic crypto trading analyst. Your job is to vote on whether to open a NEW position.

== MARKET DATA ==
${marketIntelligence}

== PORTFOLIO STATUS ==
- Total Value: $${portfolio.totalValue.toFixed(2)}
- Available Cash: $${portfolio.availableCash.toFixed(2)}
- Risk Budget Per Trade: $${riskPerTrade.toFixed(2)} (3% of portfolio)

== CURRENT OPEN POSITIONS ==
${
	openPositions.length === 0
		? "None - portfolio is fully in cash"
		: openPositions
				.map(
					(p) =>
						`- ${p.symbol} ${p.sign}: ${p.quantity} @ $${p.entryPrice} (Unrealized PnL: $${p.unrealizedPnl ?? "N/A"})`,
				)
				.join("\n")
}

== TRADEABLE SYMBOLS ==
${availableSymbols}

== YOUR TASK ==
Analyze the market data and decide:
1. **BUY** - Open a LONG position (you expect price to go UP)
2. **SELL** - Open a SHORT position (you expect price to go DOWN)  
3. **HOLD** - No trade (market unclear or already positioned)

If voting BUY or SELL:
- Pick ONE symbol with the clearest setup
- Set quantity based on risk budget ($${riskPerTrade.toFixed(0)} max risk)
- Use leverage 1-5x (higher only with strong conviction)
- Set stop loss at invalidation level
- Set take profit at realistic target

Consider:
- RSI extremes (>70 overbought, <30 oversold)
- MACD momentum and crossovers
- EMA alignment (bullish: price > EMA20 > EMA50)
- Funding rates (avoid longs if funding > 0.05%, shorts if < -0.05%)
- Volume confirmation

Vote with confidence 1-10 (only vote BUY/SELL if confidence >= 6).`;

		const result = await generateObject({
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK type mismatch
			model: model as any,
			schema: voterDecisionSchema,
			prompt,
			...(isOpenRouter && {
				providerOptions: {
					openrouter: {
						reasoning: {
							effort: "high",
							exclude: false,
						},
					},
				},
			}),
		});

		console.log(`[Consensus] ${voter.modelName} voted: ${result.object.action} ${result.object.symbol ?? ""} (confidence: ${result.object.confidence})`);

		return {
			voterId: voter.modelId,
			voterName: voter.modelName,
			decision: result.object,
			latencyMs: Date.now() - startTime,
		};
	} catch (error) {
		console.error(`[Consensus] ${voter.modelName} error:`, error);
		return {
			voterId: voter.modelId,
			voterName: voter.modelName,
			decision: {
				action: "HOLD",
				symbol: null,
				side: null,
				confidence: 0,
				quantity: null,
				leverage: null,
				stopLoss: null,
				takeProfit: null,
				reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
			},
			latencyMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Aggregate votes and determine consensus
 */
function aggregateVotes(
	results: VoterResult[],
	config: ConsensusConfig,
): ConsensusResult {
	const validResults = results.filter((r) => !r.error);

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
		const weight = voter?.weight ?? 1;
		weightedSum += vote.decision.confidence * weight;
		weightTotal += weight;
	}
	const weightedConfidence = weightTotal > 0 ? weightedSum / weightTotal : 0;

	// Determine if we should execute
	const hasMinAgreement = agreementCount >= config.minAgreement;
	const meetsConfidenceThreshold = avgConfidence >= config.confidenceThreshold;
	const isActionable = winningAction !== "HOLD";
	const shouldExecute = hasMinAgreement && meetsConfidenceThreshold && isActionable;

	// Debug logging for why we're not executing
	if (!shouldExecute && isActionable) {
		console.log(
			`[Consensus] Not executing: hasMinAgreement=${hasMinAgreement} (${agreementCount}/${config.minAgreement}), ` +
			`meetsConfidence=${meetsConfidenceThreshold} (${avgConfidence.toFixed(1)}/${config.confidenceThreshold})`
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

		const medianQuantity =
			quantities.length > 0
				? quantities.sort((a, b) => a - b)[Math.floor(quantities.length / 2)]
				: 0;
		const medianLeverage =
			leverages.length > 0
				? leverages.sort((a, b) => a - b)[Math.floor(leverages.length / 2)]
				: 1;
		const medianStop =
			stops.length > 0
				? stops.sort((a, b) => a - b)[Math.floor(stops.length / 2)]
				: null;
		const medianTarget =
			targets.length > 0
				? targets.sort((a, b) => a - b)[Math.floor(targets.length / 2)]
				: null;

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

	// Compile reasoning from agreeing voters
	const reasoning = winningVotes
		.map((v) => `[${v.voterName}]: ${v.decision.reasoning}`)
		.join("\n");

	return {
		consensus: winningAction,
		symbol: consensusSymbol,
		side: winningAction === "BUY" ? "LONG" : winningAction === "SELL" ? "SHORT" : null,
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

// ==================== Main Orchestrator ====================

/**
 * Run parallel consensus voting across multiple models
 */
export async function runConsensusVoting(
	config: ConsensusConfig,
	marketIntelligence: string,
	portfolio: PortfolioSnapshot,
	openPositions: EnrichedOpenPosition[],
): Promise<ConsensusResult> {
	// Run all voters in parallel with timeout
	const voterPromises = config.voters.map((voter) =>
		Promise.race([
			getVoterDecision(voter, marketIntelligence, portfolio, openPositions),
			new Promise<VoterResult>((_, reject) =>
				setTimeout(
					() => reject(new Error(`Timeout after ${config.timeoutMs}ms`)),
					config.timeoutMs,
				),
			),
		]).catch(
			(error): VoterResult => ({
				voterId: voter.modelId,
				voterName: voter.modelName,
				decision: {
					action: "HOLD",
					symbol: null,
					side: null,
					confidence: 0,
					quantity: null,
					leverage: null,
					stopLoss: null,
					takeProfit: null,
					reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
				},
				latencyMs: config.timeoutMs,
				error: error instanceof Error ? error.message : String(error),
			}),
		),
	);

	const results = await Promise.all(voterPromises);
	return aggregateVotes(results, config);
}

// ==================== Default Configuration ====================

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
	voters: [
		// {
		// 	modelId: "minimax-m2",
		// 	modelName: "minimax-m2",
		// 	openRouterModelName: "minimaxai/minimax-m2",
		// 	weight: 1.0, // Slightly higher weight for reasoning model
		// },
		// {
		// 	modelId: "deepseek-v3.1-terminus",
		// 	modelName: "deepseek-v3.1-terminus",
		// 	openRouterModelName: "deepseek-ai/deepseek-v3.1-terminus",
		// 	weight: 1.0,
		// },
		// {
		// 	modelId: "kimi-k2-instruct-0905",
		// 	modelName: "kimi-k2-instruct-0905",
		// 	openRouterModelName: "moonshotai/kimi-k2-instruct-0905",
		// 	weight: 1.0,
		// },
		// {
		// 	modelId: "gpt-oss-120b",
		// 	modelName: "gpt-oss-120b",
		// 	openRouterModelName: "openai/gpt-oss-120b",
		// 	weight: 1.0,
		// },
		// {
		// 	modelId: "deepseek-ai/deepseek-r1-0528",
		// 	modelName: "deepseek-r1-0528",
		// 	openRouterModelName: "deepseek-ai/deepseek-r1-0528",
		// 	weight: 1.0,
		// },
		{
			modelId: "kat-coder-pro",
			modelName: "kat-coder-pro",
			openRouterModelName: "kwaipilot/kat-coder-pro:free",
			weight: 1.0,
		}
	],
	minAgreement: 2, // At least 2/3 must agree
	confidenceThreshold: 6, // Average confidence must be >= 6
	timeoutMs: 60000, // 60 second timeout per voter
};

// ==================== Consensus Workflow ====================

/** Reserved model name for the consensus orchestrator */
export const CONSENSUS_MODEL_NAME = "consensus-orchestrator";

/**
 * Run the full consensus workflow:
 * 1. Fetch market data and portfolio for the consensus account
 * 2. Run parallel voting across voter models
 * 3. Execute trade if consensus is reached
 * 4. Record invocation and emit events
 */
export async function runConsensusWorkflow(
	consensusAccount: Account,
	config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG,
): Promise<string> {
	const queryClient = new QueryClient();

	// Fetch portfolio and positions for the consensus account
	const [portfolio, openPositionsRaw] = await Promise.all([
		queryClient.fetchQuery(portfolioQuery(consensusAccount)),
		queryClient.fetchQuery(openPositionsQuery(consensusAccount)),
	]);

	const openPositions = enrichOpenPositions(openPositionsRaw, new Map());

	// Fetch market data
	const marketUniverse = Object.entries(MARKETS).map(([symbol, meta]) => ({
		symbol,
		marketId: meta.marketId,
	}));

	let marketIntelligence = "Market data unavailable.";
	try {
		const snapshots = await queryClient.fetchQuery(
			marketSnapshotsQuery(marketUniverse),
		);
		marketIntelligence = formatMarketSnapshots(snapshots);
	} catch (error) {
		console.error("[Consensus] Failed to fetch market data", error);
	}

	// Create invocation record
	const modelInvocation = await createInvocationMutation(consensusAccount.id);

	try {
		// Run consensus voting
		console.log(`[Consensus] Starting voting with ${config.voters.length} voters`);
		const consensusResult = await runConsensusVoting(
			config,
			marketIntelligence,
			portfolio,
			openPositions,
		);

		// Log each voter's decision for debugging
		for (const voter of consensusResult.voterResults) {
			console.log(
				`[Consensus] ${voter.voterName}: ${voter.decision.action} ${voter.decision.symbol ?? "N/A"} ` +
				`conf=${voter.decision.confidence} qty=${voter.decision.quantity} ` +
				`(${voter.latencyMs}ms)${voter.error ? ` ERROR: ${voter.error}` : ""}`
			);
		}

		console.log(
			`[Consensus] Result: ${consensusResult.consensus} | Agreement: ${consensusResult.agreementCount}/${consensusResult.totalVoters} | Confidence: ${consensusResult.averageConfidence.toFixed(1)} | Execute: ${consensusResult.shouldExecute}`,
		);

		let executionResult = "";

		// Execute trade if consensus is reached
		if (consensusResult.shouldExecute && consensusResult.symbol && consensusResult.side && consensusResult.executionParams) {
			const positionRequest: PositionRequest = {
				symbol: consensusResult.symbol,
				side: consensusResult.side,
				quantity: consensusResult.executionParams.quantity,
				leverage: consensusResult.executionParams.leverage,
				stopLoss: consensusResult.executionParams.stopLoss,
				profitTarget: consensusResult.executionParams.takeProfit,
				invalidationCondition: null,
				confidence: consensusResult.averageConfidence,
			};

			console.log(`[Consensus] Executing trade: ${positionRequest.side} ${positionRequest.symbol} qty=${positionRequest.quantity}`);

			const results = await createPosition(consensusAccount, [positionRequest]);
			const success = results.filter((r) => r.success);
			const failed = results.filter((r) => !r.success);

			if (success.length > 0) {
				executionResult = `Trade executed: ${success.map((r) => `${r.side} ${r.symbol} @ ${r.entryPrice}`).join(", ")}`;
			}
			if (failed.length > 0) {
				executionResult += ` Failed: ${failed.map((r) => `${r.symbol}: ${r.error}`).join(", ")}`;
			}
		} else {
			executionResult = "No trade executed (insufficient consensus or HOLD decision)";
		}

		// Build response
		const response = [
			`## Consensus Decision: ${consensusResult.consensus}`,
			`**Agreement:** ${consensusResult.agreementCount}/${consensusResult.totalVoters} voters`,
			`**Average Confidence:** ${consensusResult.averageConfidence.toFixed(1)}/10`,
			`**Weighted Confidence:** ${consensusResult.weightedConfidence.toFixed(1)}/10`,
			consensusResult.symbol ? `**Symbol:** ${consensusResult.symbol}` : "",
			`**Should Execute:** ${consensusResult.shouldExecute ? "Yes" : "No"}`,
			"",
			`### Execution`,
			executionResult,
			"",
			`### Voter Reasoning`,
			consensusResult.reasoning,
		]
			.filter(Boolean)
			.join("\n");

		// Update invocation record
		await updateInvocationMutation({
			id: modelInvocation.id,
			response,
			responsePayload: {
				type: "consensus",
				consensus: consensusResult.consensus,
				symbol: consensusResult.symbol,
				side: consensusResult.side,
				agreementCount: consensusResult.agreementCount,
				totalVoters: consensusResult.totalVoters,
				averageConfidence: consensusResult.averageConfidence,
				weightedConfidence: consensusResult.weightedConfidence,
				shouldExecute: consensusResult.shouldExecute,
				executionParams: consensusResult.executionParams,
				voterResults: consensusResult.voterResults.map((v) => ({
					voterId: v.voterId,
					voterName: v.voterName,
					action: v.decision.action,
					symbol: v.decision.symbol,
					confidence: v.decision.confidence,
					latencyMs: v.latencyMs,
					error: v.error,
				})),
			},
		});

		// Increment usage
		await incrementModelUsageMutation({
			modelId: consensusAccount.id,
			deltas: { invocationCountDelta: 1, totalMinutesDelta: 5 },
		});

		// Emit SSE update
		await emitAllDataChanged(consensusAccount.id);

		return response;
	} catch (error) {
		const failureMessage = `Consensus workflow failed: ${error instanceof Error ? error.message : String(error)}`;
		console.error(`[Consensus] ${failureMessage}`, error);

		// Increment failed workflow count
		await incrementModelUsageMutation({
			modelId: consensusAccount.id,
			deltas: { failedWorkflowCountDelta: 1 },
		});

		await updateInvocationMutation({
			id: modelInvocation.id,
			response: failureMessage,
			responsePayload: { error: failureMessage },
		});

		return failureMessage;
	}
}
