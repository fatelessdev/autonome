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

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAihubmix } from "@aihubmix/ai-sdk-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { QueryClient } from "@tanstack/react-query";
import { generateObject } from "ai";
import { getModelProvider } from "@/core/shared/models/modelConfig";
import type { Model } from "@/db/schema";
import {
	getNextAihubmixApiKey,
	getNextNimApiKey,
	getNextOpenRouterApiKey,
} from "@/env";
import {
	createInvocationMutation,
	incrementModelUsageMutation,
	updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import { emitAllDataChanged } from "@/server/events/workflowEvents";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getSharedMarketIntelligence } from "@/server/features/trading/data/marketIntelligenceCache";
import type { EnrichedOpenPosition } from "@/server/features/trading/data/openPositionEnrichment";
import { enrichOpenPositions } from "@/server/features/trading/data/openPositionEnrichment";
import type { PortfolioSnapshot } from "@/server/features/trading/data/portfolio";
import { portfolioQuery } from "@/server/features/trading/data/portfolio.server";
import { openPositionsQuery } from "@/server/features/trading/data/positions.server";
import {
	createPosition,
	type PositionRequest,
} from "@/server/features/trading/execution/createPosition";
import { getSharedNewsDigest } from "@/server/integrations/alpaca-news";
import { MARKETS } from "@/core/shared/markets/marketMetadata";
import {
	aggregateVotes,
	buildFailedVoterResult,
	type ConsensusConfig,
	type ConsensusResult,
	type ConsensusVoter,
	toErrorMessage,
	type VoterResult,
	voterDecisionSchema,
} from "./consensusVoting";

// Re-export types so external consumers are unaffected
export type {
	ConsensusConfig,
	ConsensusResult,
	ConsensusVoter,
	VoterDecision,
	VoterResult,
} from "./consensusVoting";

// ==================== Types ====================

export interface ConsensusPreparationResult {
	account: Account;
	config: ConsensusConfig;
	voterCount: number;
}

// ==================== Provider Setup ====================

function createProviders() {
	// Use cycling API key for NIM to avoid rate limits
	const nimApiKey = getNextNimApiKey();
	const nim = createOpenAICompatible({
		name: "nim",
		baseURL: "https://integrate.api.nvidia.com/v1",
		headers: {
			Authorization: `Bearer ${nimApiKey}`,
		},
	});

	const openrouter = createOpenRouter({
		apiKey: getNextOpenRouterApiKey(),
	});

	const aihubmix = createAihubmix({
		apiKey: getNextAihubmixApiKey(),
	});

	return { nim, openrouter, aihubmix };
}

// ==================== Voting Logic ====================

/**
 * Get a single voter's decision
 */
async function getVoterDecision(
	voter: ConsensusVoter,
	marketIntelligence: string,
	newsDigest: string,
	portfolio: PortfolioSnapshot,
	openPositions: EnrichedOpenPosition[],
): Promise<VoterResult> {
	const { nim, openrouter, aihubmix } = createProviders();
	const startTime = Date.now();

	try {
		const provider = getModelProvider(voter.name);
		const isOpenRouter = provider === "openrouter";
		const model =
			provider === "openrouter"
				? openrouter(voter.routerModelName)
				: provider === "aihubmix"
					? aihubmix(voter.routerModelName)
					: nim.chatModel(voter.routerModelName);

		const availableSymbols = Object.keys(MARKETS).join(", ");
		const riskPerTrade = portfolio.totalValue * 0.03; // 3% risk per trade

		const prompt = `You are a systematic crypto trading analyst. Your job is to vote on whether to open a NEW position.

== MARKET DATA ==
${marketIntelligence}

== NEWS ==
${newsDigest || "No recent news."}

== PORTFOLIO STATUS ==
- Total Value: $${portfolio.totalValue.toFixed(2)}
- Available Cash: $${portfolio.availableCash.toFixed(2)}
- Risk Budget Per Trade: $${riskPerTrade.toFixed(2)} (3% of portfolio)

== CURRENT OPEN POSITIONS ==
${
	openPositions.length === 0
		? "None - portfolio is fully in cash"
		: openPositions
				.map((p) => {
					let line = `- ${p.symbol} ${p.side}: ${p.quantity} @ $${p.entryPrice} (Unrealized PnL: $${p.unrealizedPnl ?? "N/A"})`;
					if (p.unrealizedIntradayPl != null) {
						line += ` (Intraday: $${p.unrealizedIntradayPl.toFixed(2)})`;
					}
					if (p.changeToday != null) {
						line += ` (Change Today: ${(p.changeToday * 100).toFixed(2)}%)`;
					}
					return line;
				})
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

		console.log(
			`[Consensus] ${voter.name} voted: ${result.object.action} ${result.object.symbol ?? ""} (confidence: ${result.object.confidence})`,
		);

		return {
			voterId: voter.modelId,
			voterName: voter.name,
			decision: result.object,
			latencyMs: Date.now() - startTime,
		};
	} catch (error) {
		console.error(`[Consensus] ${voter.name} error:`, error);
		return buildFailedVoterResult(
			voter.modelId,
			voter.name,
			error,
			Date.now() - startTime,
		);
	}
}

// ==================== Main Orchestrator ====================

/**
 * Run parallel consensus voting across multiple models
 */
export async function runConsensusVoting(
	config: ConsensusConfig,
	marketIntelligence: string,
	newsDigest: string,
	portfolio: PortfolioSnapshot,
	openPositions: EnrichedOpenPosition[],
): Promise<ConsensusResult> {
	// Run all voters in parallel with timeout
	const voterPromises = config.voters.map((voter) =>
		Promise.race([
			getVoterDecision(
				voter,
				marketIntelligence,
				newsDigest,
				portfolio,
				openPositions,
			),
			new Promise<VoterResult>((_, reject) =>
				setTimeout(
					() => reject(new Error(`Timeout after ${config.timeoutMs}ms`)),
					config.timeoutMs,
				),
			),
		]).catch(
			(error): VoterResult =>
				buildFailedVoterResult(
					voter.modelId,
					voter.name,
					error,
					config.timeoutMs,
				),
		),
	);

	const results = await Promise.all(voterPromises);
	return aggregateVotes(results, config);
}

// ==================== Default Configuration ====================

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
	voters: [
		{
			modelId: "kat-coder-pro",
			name: "kat-coder-pro",
			routerModelName: "kwaipilot/kat-coder-pro:free",
			weight: 1.0,
		},
	],
	minAgreement: 1, // single voter default config
	confidenceThreshold: 6, // Average confidence must be >= 6
	timeoutMs: 60000, // 60 second timeout per voter
};

// ==================== Consensus Workflow ====================

/** Reserved model name for the consensus orchestrator */
export const CONSENSUS_MODEL_NAME = "consensus-orchestrator";

const toConsensusAccount = (model: Model): Account => ({
	id: model.id,
	name: model.name,
	modelName: model.openRouterModelName,
	alpacaApiKey: model.alpacaApiKey,
	alpacaApiSecret: model.alpacaApiSecret,
	invocationCount: model.invocationCount,
	totalMinutes: model.totalMinutes,
	variant: model.variant,
});

export const isConsensusModel = (modelName: string): boolean =>
	modelName.trim().toLowerCase() === CONSENSUS_MODEL_NAME;

const computeDefaultMinAgreement = (voterCount: number): number => {
	if (voterCount <= 0) {
		throw new Error("Cannot compute min agreement with zero voters");
	}
	return Math.max(1, Math.ceil((voterCount * 2) / 3));
};

export function buildConsensusConfigFromVoterModels(
	models: Model[],
): ConsensusConfig {
	if (models.length === 0) {
		throw new Error("Consensus requires at least one voter model");
	}

	const voters = models.map((model) => {
		// Fail fast when a voter model cannot be resolved to a provider contract.
		getModelProvider(model.name);
		return {
			modelId: model.id,
			name: model.name,
			routerModelName: model.openRouterModelName,
			weight: 1,
		};
	});

	return {
		voters,
		minAgreement: computeDefaultMinAgreement(voters.length),
		confidenceThreshold: 6,
		timeoutMs: 60_000,
	};
}

export function prepareConsensusWorkflowFromModels(
	models: Model[],
): ConsensusPreparationResult | null {
	const consensusAccountModel = models.find((model) =>
		isConsensusModel(model.name),
	);
	if (!consensusAccountModel) {
		return null;
	}

	const voterModels = models.filter(
		(model) =>
			model.id !== consensusAccountModel.id && !isConsensusModel(model.name),
	);
	if (voterModels.length === 0) {
		throw new Error(
			`Consensus account "${consensusAccountModel.name}" is configured but there are no voter models available`,
		);
	}

	const config = buildConsensusConfigFromVoterModels(voterModels);
	return {
		account: toConsensusAccount(consensusAccountModel),
		config,
		voterCount: config.voters.length,
	};
}

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

	// Fetch shared market data (cached across all models in the same cycle)
	const [marketResult, news] = await Promise.all([
		getSharedMarketIntelligence({
			alpacaApiKey: consensusAccount.alpacaApiKey,
			alpacaApiSecret: consensusAccount.alpacaApiSecret,
		}),
		getSharedNewsDigest({
			alpacaApiKey: consensusAccount.alpacaApiKey,
			alpacaApiSecret: consensusAccount.alpacaApiSecret,
		}),
	]);
	const marketIntelligence = marketResult.formatted;
	const newsDigest = news.formatted;

	// Create invocation record
	const modelInvocation = await createInvocationMutation(consensusAccount.id);

	try {
		// Run consensus voting
		console.log(
			`[Consensus] Starting voting with ${config.voters.length} voters`,
		);
		const consensusResult = await runConsensusVoting(
			config,
			marketIntelligence,
			newsDigest,
			portfolio,
			openPositions,
		);

		// Log each voter's decision for debugging
		for (const voter of consensusResult.voterResults) {
			console.log(
				`[Consensus] ${voter.voterName}: ${voter.decision.action} ${voter.decision.symbol ?? "N/A"} ` +
					`conf=${voter.decision.confidence} qty=${voter.decision.quantity} ` +
					`(${voter.latencyMs}ms)${voter.error ? ` ERROR: ${voter.error}` : ""}`,
			);
		}

		console.log(
			`[Consensus] Result: ${consensusResult.consensus} | Agreement: ${consensusResult.agreementCount}/${consensusResult.totalVoters} | Confidence: ${consensusResult.averageConfidence.toFixed(1)} | Execute: ${consensusResult.shouldExecute}`,
		);

		let executionResult = "";

		// Execute trade if consensus is reached
		if (
			consensusResult.shouldExecute &&
			consensusResult.symbol &&
			consensusResult.side &&
			consensusResult.executionParams
		) {
			const positionRequest: PositionRequest = {
				symbol: consensusResult.symbol,
				side: consensusResult.side,
				quantity: consensusResult.executionParams.quantity,
				stopLoss: consensusResult.executionParams.stopLoss,
				profitTarget: consensusResult.executionParams.takeProfit,
				invalidationCondition: null,
				invalidationPrice: null,
				timeExit: null,
				cooldownUntil: null,
				confidence: consensusResult.averageConfidence,
			};

			console.log(
				`[Consensus] Executing trade: ${positionRequest.side} ${positionRequest.symbol} qty=${positionRequest.quantity}`,
			);

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
			executionResult =
				"No trade executed (insufficient consensus or HOLD decision)";
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
		const failureMessage = `Consensus workflow failed: ${toErrorMessage(error)}`;
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
