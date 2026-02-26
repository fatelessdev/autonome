/**
 * Trade Executor
 *
 * Orchestrates trade workflows using the modular agent architecture.
 * Scheduler logic has been removed — invocation is now triggered by Workflow DevKit steps.
 */

import { QueryClient } from "@tanstack/react-query";

import { listModels } from "@/server/db/tradingRepository";
import {
	createInvocationMutation,
	incrementModelUsageMutation,
	updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { fetchLatestDecisionIndex } from "@/server/features/trading/contracts/decisionIndex";
import { portfolioQuery } from "@/server/features/trading/data/portfolio.server";
import {
	buildInvocationResponsePayload,
	type InvocationClosedPositionSummary,
	type InvocationDecisionSummary,
	type InvocationExecutionResultSummary,
	type StepTelemetry,
} from "@/server/features/trading/contracts/invocationResponse";
import {
	getSharedMarketIntelligence,
	invalidateMarketIntelligenceCache,
} from "@/server/features/trading/data/marketIntelligenceCache";
import {
	getSharedNewsDigest,
	invalidateNewsCache,
} from "@/server/integrations/alpaca-news";
import {
	enrichOpenPositions,
	summarizePositionRisk,
} from "@/server/features/trading/data/openPositionEnrichment";
import { openPositionsQuery } from "@/server/features/trading/data/positions.server";
import { calculatePerformanceMetrics } from "@/server/features/trading/analysis/performanceMetrics";
import { buildTradingPrompts } from "@/server/features/trading/prompting/promptBuilder";
import { buildCompetitionSnapshot } from "@/server/features/trading/analysis/competitionSnapshot";
import type { TradingDecisionWithContext } from "@/server/features/trading/contracts/tradingDecisions";
import {
	type VariantId,
	DEFAULT_VARIANT,
} from "@/server/features/trading/prompting/prompts/variants";
import { TRADEABLE_VARIANT_IDS } from "@/shared/variants";
import {
	emitAllDataChanged,
	emitBatchComplete,
} from "@/server/events/workflowEvents";
import {
	CONSENSUS_MODEL_NAME,
} from "@/server/features/trading/execution/orchestrator";

import { createTradeAgent, type ToolContext } from "../agent";

/** Result returned from runTradeWorkflow for outer timeout handling */
export interface TradeWorkflowResult {
	response: string;
	invocationId: string;
}

const AGENT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per agent call

/**
 * Runs a complete trade workflow for a single account.
 * This is the core logic — scheduling is handled by Workflow DevKit.
 */
export async function runTradeWorkflow(account: Account): Promise<string> {
	const queryClient = new QueryClient();

	// Fetch initial data in parallel
	const [portfolio, openPositionsRaw, decisionIndex] = await Promise.all([
		queryClient.fetchQuery(portfolioQuery(account)),
		queryClient.fetchQuery(openPositionsQuery(account)),
		account.id
			? fetchLatestDecisionIndex(account.id)
			: Promise.resolve(
					new Map<string, TradingDecisionWithContext>(),
				),
	]);

	const openPositions = enrichOpenPositions(openPositionsRaw, decisionIndex);
	const exposureSummary = summarizePositionRisk(openPositions);

	// Initialize telemetry capture arrays
	const capturedDecisions: InvocationDecisionSummary[] = [];
	const capturedExecutionResults: InvocationExecutionResultSummary[] = [];
	const capturedClosedPositions: InvocationClosedPositionSummary[] = [];
	const capturedStepTelemetry: StepTelemetry[] = [];

	// Track symbols acted on this session to prevent duplicate actions
	const actedSymbols = new Set<string>();
	const closedPositionCooldowns = new Map<
		string,
		{ side: "LONG" | "SHORT"; cooldownUntil: string }
	>();
	const symbolActionCounts = new Map<string, number>();

	// Fetch shared market data (cached across all models in the same cycle)
	let marketIntelligence = "Market data unavailable.";
	let newsDigest = "";
	try {
		const [marketResult, newsResult] = await Promise.all([
			getSharedMarketIntelligence({
				alpacaApiKey: account.alpacaApiKey,
				alpacaApiSecret: account.alpacaApiSecret,
			}),
			getSharedNewsDigest({
				alpacaApiKey: account.alpacaApiKey,
				alpacaApiSecret: account.alpacaApiSecret,
			}),
		]);
		marketIntelligence = marketResult.formatted;
		newsDigest = newsResult.formatted;
	} catch (error) {
		console.error("Failed to assemble market intelligence", error);
	}

	const currentTime = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Kolkata",
		hour: "2-digit",
		minute: "2-digit",
		hour12: true,
	}).format(new Date());

	// Create invocation record
	const modelInvocation = await createInvocationMutation(account.id);

	// Calculate performance metrics
	const currentPortfolioValue = Number.parseFloat(portfolio.total);
	const performanceMetrics = await calculatePerformanceMetrics(
		account,
		currentPortfolioValue,
	);

	const variantId = account.variant ?? DEFAULT_VARIANT;

	// Leaderboard context (variant-scoped)
	const competitionSnapshot = await buildCompetitionSnapshot({
		modelId: account.id,
		variant: variantId,
	});

	// Build prompts
	const enrichedPrompt = buildTradingPrompts({
		account,
		portfolio,
		openPositions,
		exposureSummary,
		performanceMetrics,
		marketIntelligence,
		newsDigest,
		currentTime,
		variant: variantId,
		symbolActionCounts,
		competition: competitionSnapshot,
	});

	// Create tool context for shared state
	const toolContext: ToolContext = {
		account,
		invocationId: modelInvocation.id,
		openPositions,
		decisionIndex,
		actedSymbols,
		closedPositionCooldowns,
		symbolActionCounts,
		capturedDecisions,
		capturedExecutionResults,
		capturedClosedPositions,
	};

	/**
	 * Rebuilds the state summary with fresh portfolio data.
	 * Called by prepareStep after each tool call.
	 */
	const rebuildUserPrompt = async (): Promise<string> => {
		const freshQueryClient = new QueryClient();
		const [freshPortfolio, freshPositionsRaw, freshDecisionIndex] =
			await Promise.all([
				freshQueryClient.fetchQuery(portfolioQuery(account)),
				freshQueryClient.fetchQuery(openPositionsQuery(account)),
				account.id
					? fetchLatestDecisionIndex(account.id)
					: Promise.resolve(
							new Map<string, TradingDecisionWithContext>(),
						),
			]);

		const freshPositions = enrichOpenPositions(
			freshPositionsRaw,
			freshDecisionIndex,
		);
		const freshExposure = summarizePositionRisk(freshPositions);

		toolContext.openPositions = freshPositions;
		toolContext.decisionIndex = freshDecisionIndex;

		const freshPrompt = buildTradingPrompts({
			account,
			portfolio: freshPortfolio,
			openPositions: freshPositions,
			exposureSummary: freshExposure,
			performanceMetrics,
			marketIntelligence,
			newsDigest,
			currentTime,
			variant: variantId,
			symbolActionCounts,
			competition: competitionSnapshot,
		});

		return freshPrompt.stateSummary;
	};
	// Create the agent
	const { agent } = createTradeAgent({
		account,
		systemPrompt: enrichedPrompt.systemPrompt,
		toolContext,
		onStepTelemetry: (telemetry) => capturedStepTelemetry.push(telemetry),
		rebuildUserPrompt,
	});

	let result: Awaited<ReturnType<typeof agent.generate>>;
	try {
		result = await agent.generate({
			prompt: enrichedPrompt.userPrompt,
			abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
			options: {
				reasoningEffort: "high",
			},
		});
	} catch (error) {
		const failureMessage = `Trade workflow aborted: ${error instanceof Error ? error.message : String(error)}`;
		console.error(
			`[TradeAgent] ${account.name} execution failed`,
			error,
		);

		await incrementModelUsageMutation({
			modelId: account.id,
			deltas: { failedWorkflowCountDelta: 1 },
		});

		await updateInvocationMutation({
			id: modelInvocation.id,
			response: failureMessage,
			responsePayload: buildInvocationResponsePayload({
				prompt: enrichedPrompt.userPrompt,
				result: null,
				decisions: capturedDecisions,
				executionResults: capturedExecutionResults,
				closedPositions: capturedClosedPositions,
				stepTelemetry: capturedStepTelemetry,
			}),
		});

		return failureMessage;
	}

	// Process successful result
	const toolCallTelemetry =
		(
			result as {
				toolCalls?: Array<{ toolName?: string; error?: unknown }>;
			}
		).toolCalls ?? [];
	const failedToolCalls = toolCallTelemetry.filter((call) =>
		Boolean(call?.error),
	);
	if (failedToolCalls.length > 0) {
		console.warn("Tool call failures detected", failedToolCalls);
	}

	await incrementModelUsageMutation({
		modelId: account.id,
		deltas: { invocationCountDelta: 1, totalMinutesDelta: 5 },
	});

	const responseText = result.text.trim();

	const responsePayload = buildInvocationResponsePayload({
		prompt: enrichedPrompt.userPrompt,
		result,
		decisions: capturedDecisions,
		executionResults: capturedExecutionResults,
		closedPositions: capturedClosedPositions,
		stepTelemetry: capturedStepTelemetry,
	});

	await updateInvocationMutation({
		id: modelInvocation.id,
		response: responseText,
		responsePayload,
	});

	// Emit unified workflow event
	await emitAllDataChanged(account.id);

	return responseText;
}

/**
 * Executes trades for all valid models.
 * Called by Workflow DevKit step — not by setInterval.
 */
export async function executeAllModelTrades(): Promise<{
	successCount: number;
	failureCount: number;
	totalModels: number;
}> {
	const models = await listModels();

	// Separate consensus model from regular models
	const consensusModel = models.find((m) => m.name === CONSENSUS_MODEL_NAME);
	const regularModels = models.filter(
		(m) => m.name !== CONSENSUS_MODEL_NAME,
	);

	const validModels = regularModels.filter((model) => {
		if (!model.alpacaApiKey || !model.alpacaApiSecret) {
			console.warn(
				`Model ${model.id} missing Alpaca credentials; skipping`,
			);
			return false;
		}
		const variant = (model.variant as VariantId) ?? DEFAULT_VARIANT;
		if (!TRADEABLE_VARIANT_IDS.includes(variant)) {
			console.log(
				`[TradeExecutor] Skipping ${model.name}: variant "${variant}" is not tradeable`,
			);
			return false;
		}
		return true;
	});

	if (validModels.length === 0 && !consensusModel) {
		return { successCount: 0, failureCount: 0, totalModels: 0 };
	}

	const runModel = async (
		model: (typeof validModels)[number],
	): Promise<{ modelId: string; success: boolean }> => {
		try {
			await runTradeWorkflow({
				alpacaApiKey: model.alpacaApiKey,
				alpacaApiSecret: model.alpacaApiSecret,
				modelName: model.openRouterModelName,
				name: model.name,
				invocationCount: model.invocationCount,
				id: model.id,
				totalMinutes: model.totalMinutes,
				variant:
					(model.variant as VariantId) ?? DEFAULT_VARIANT,
			});
			return { modelId: model.id, success: true };
		} catch (error) {
			console.error(
				`[TradeExecutor] Model ${model.name} failed:`,
				error,
			);
			return { modelId: model.id, success: false };
		}
	};

	const results = await Promise.all(validModels.map(runModel));

	// Invalidate market cache after batch completes
	invalidateMarketIntelligenceCache();
	invalidateNewsCache();

	const successCount = results.filter((r) => r.success).length;
	const failureCount = results.length - successCount;
	const totalModels = validModels.length;

	const successful = results.filter((r) => r.success).map((r) => r.modelId);

	if (successful.length > 0) {
		emitBatchComplete(successful);
	}

	const status =
		successCount === totalModels
			? "✅"
			: successCount > 0
				? "⚠️"
				: "❌";
	console.log(
		`[TradeExecutor] Cycle complete: ${status} ${successCount}/${totalModels} models succeeded`,
	);

	return { successCount, failureCount, totalModels };
}


