/**
 * Trade Executor
 * Orchestrates trade workflows using the modular agent architecture
 */

import { QueryClient } from "@tanstack/react-query";

import { listModels } from "@/server/db/tradingRepository";
import {
	createInvocationMutation,
	incrementModelUsageMutation,
	updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import type { Account } from "@/server/features/trading/accounts";
import { fetchPositions } from "@/server/features/trading/queries.server";
import { fetchLatestDecisionIndex } from "@/server/features/trading/decisionIndex";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";
import {
	buildInvocationResponsePayload,
	type InvocationClosedPositionSummary,
	type InvocationDecisionSummary,
	type InvocationExecutionResultSummary,
	type StepTelemetry,
} from "@/server/features/trading/invocationResponse";
import { getSharedMarketIntelligence, invalidateMarketIntelligenceCache } from "@/server/features/trading/marketIntelligenceCache";
import {
	enrichOpenPositions,
	summarizePositionRisk,
} from "@/server/features/trading/openPositionEnrichment";
import { openPositionsQuery } from "@/server/features/trading/openPositions.server";
import { calculatePerformanceMetrics } from "@/server/features/trading/performanceMetrics";
import { buildTradingPrompts } from "@/server/features/trading/promptBuilder";
import { buildCompetitionSnapshot } from "@/server/features/trading/competitionSnapshot";
import type { TradingDecisionWithContext } from "@/server/features/trading/tradingDecisions";
import {
	type VariantId,
	DEFAULT_VARIANT,
	getVariantConfig,
} from "@/server/features/trading/prompts/variants";
import {
	emitAllDataChanged,
	emitBatchComplete,
} from "@/server/events/workflowEvents";
import { analyzeToolCallFailure } from "@/server/features/analytics/toolCallAnalyzer";
import {
	runConsensusWorkflow,
	CONSENSUS_MODEL_NAME,
} from "@/server/features/trading/orchestrator";

import { createTradeAgent, type ToolContext } from "./agent";

declare global {
	// eslint-disable-next-line no-var
	var tradeIntervalHandle: ReturnType<typeof setInterval> | undefined;
	// eslint-disable-next-line no-var
	var modelsRunning: Map<string, boolean> | undefined;
}

// Initialize per-model running state
if (!globalThis.modelsRunning) {
	globalThis.modelsRunning = new Map();
}

const TRADE_INTERVAL_MS = 5 * 60 * 1000;
const AGENT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const MAX_RETRIES = 2;

/**
 * Runs a complete trade workflow for a single account
 */
export async function runTradeWorkflow(account: Account) {
	const queryClient = new QueryClient();

	// Fetch initial data in parallel
	const [portfolio, openPositionsRaw, decisionIndex] = await Promise.all([
		queryClient.fetchQuery(portfolioQuery(account)),
		queryClient.fetchQuery(openPositionsQuery(account)),
		account.id
			? fetchLatestDecisionIndex(account.id)
			: Promise.resolve(new Map<string, TradingDecisionWithContext>()),
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

	// Track per-symbol action counts for session limits
	const symbolActionCounts = new Map<string, number>();

	// Fetch shared market data (cached across all models in the same cycle)
	let marketIntelligence = "Market data unavailable.";
	try {
		const { formatted } = await getSharedMarketIntelligence();
		marketIntelligence = formatted;
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
	const currentPortfolioValue = parseFloat(portfolio.total);
	const performanceMetrics = await calculatePerformanceMetrics(
		account,
		currentPortfolioValue,
	);

	// Get variant config for temperature and other settings
	const variantId = account.variant ?? DEFAULT_VARIANT;
	const variantConfig = getVariantConfig(variantId);

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
		symbolActionCounts,
		capturedDecisions,
		capturedExecutionResults,
		capturedClosedPositions,
	};

	/**
	 * Rebuilds the state summary with fresh portfolio data.
	 * Called by prepareStep after each tool call to provide a compact
	 * state update that gets appended (not rewritten) to preserve causality.
	 */
	const rebuildUserPrompt = async (): Promise<string> => {
		// Re-fetch fresh portfolio and positions data
		const freshQueryClient = new QueryClient();
		const [freshPortfolio, freshPositionsRaw, freshDecisionIndex] = await Promise.all([
			freshQueryClient.fetchQuery(portfolioQuery(account)),
			freshQueryClient.fetchQuery(openPositionsQuery(account)),
			account.id
				? fetchLatestDecisionIndex(account.id)
				: Promise.resolve(new Map<string, TradingDecisionWithContext>()),
		]);

		const freshPositions = enrichOpenPositions(freshPositionsRaw, freshDecisionIndex);
		const freshExposure = summarizePositionRisk(freshPositions);

		// Update tool context with fresh positions (for subsequent tool calls)
		toolContext.openPositions = freshPositions;
		toolContext.decisionIndex = freshDecisionIndex;

		// Rebuild the prompt with fresh data - returns stateSummary for appending
		const freshPrompt = buildTradingPrompts({
			account,
			portfolio: freshPortfolio,
			openPositions: freshPositions,
			exposureSummary: freshExposure,
			performanceMetrics, // Metrics don't change mid-invocation
			marketIntelligence, // Market data doesn't change mid-invocation
			currentTime,
			variant: variantId,
			symbolActionCounts, // Include current action counts
			competition: competitionSnapshot,
		});

		// Return the compact state summary instead of full prompt
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

	// Execute with retry logic
	const executeWithRetry = async (): Promise<
		Awaited<ReturnType<typeof agent.generate>>
	> => {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

			try {
				// Reset step counter and telemetry for each retry attempt
				capturedStepTelemetry.length = 0;
				const result = await agent.generate({
					prompt: enrichedPrompt.userPrompt,
					abortSignal: controller.signal,
					options: {
						reasoningEffort: "high",
					},
				});
				clearTimeout(timeoutId);
				return result;
			} catch (error) {
				clearTimeout(timeoutId);
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if this is a retryable error
				const isTimeout =
					controller.signal.aborted || lastError.name === "TimeoutError";
				const isServerError =
					lastError.message.includes("500") ||
					lastError.message.includes("502");
				const isRetryable = isTimeout || isServerError;

				if (!isRetryable || attempt === MAX_RETRIES) {
					console.error(
						`[TradeAgent] ${account.name} failed after ${attempt + 1} attempt(s): ${lastError.message}`,
					);
					throw lastError;
				}

				// Exponential backoff: 5s, 15s
				const backoffMs = 5000 * (attempt + 1);
				console.warn(
					`[TradeAgent] ${account.name} attempt ${attempt + 1} failed (${isTimeout ? "timeout" : "server error"}), retrying in ${backoffMs / 1000}s...`,
				);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}

		throw lastError ?? new Error("Unknown error in retry loop");
	};

	let result: Awaited<ReturnType<typeof agent.generate>>;
	try {
		result = await executeWithRetry();
	} catch (error) {
		const failureMessage = `Trade workflow aborted: ${error instanceof Error ? error.message : String(error)}`;
		console.error(`[TradeAgent] ${account.name} execution failed`, error);

		// Increment failed workflow count
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

	// Analyze tool call failures with Codestral (fire and forget)
	analyzeToolCallFailure({
		modelId: account.id,
		invocationId: modelInvocation.id,
		responseText,
		isError: false,
		toolCalls: toolCallTelemetry,
		decisions: capturedDecisions,
		closedPositions: capturedClosedPositions,
	}).catch((err) => {
		console.warn("Tool call analysis failed:", err);
	});

	// Refresh positions to emit SSE update
	await fetchPositions();

	// Emit unified workflow event
	await emitAllDataChanged(account.id);

	return responseText;
}

/**
 * Executes scheduled trades for all valid models
 */
export async function executeScheduledTrades() {
	const models = await listModels();
	
	// Separate consensus model from regular models
	const consensusModel = models.find((m) => m.name === CONSENSUS_MODEL_NAME);
	const regularModels = models.filter((m) => m.name !== CONSENSUS_MODEL_NAME);
	
	const validModels = regularModels.filter((model) => {
		if (!model.lighterApiKey) {
			console.warn(
				`Model ${model.id} missing lighterApiKey; skipping scheduled trade`,
			);
			return false;
		}
		return true;
	});

	if (validModels.length === 0 && !consensusModel) {
		return;
	}

	// Filter out models that are still running from previous cycle
	const modelsToRun = validModels.filter((model) => {
		const isRunning = globalThis.modelsRunning?.get(model.id) ?? false;
		return !isRunning;
	});

	// Check if consensus is already running
	const consensusIsRunning = consensusModel
		? (globalThis.modelsRunning?.get(consensusModel.id) ?? false)
		: false;

	if (modelsToRun.length === 0 && (!consensusModel || consensusIsRunning)) {
		return;
	}

	// Mark models as running
	for (const model of modelsToRun) {
		globalThis.modelsRunning?.set(model.id, true);
	}

	// Run regular model workflow
	const runModel = async (model: (typeof modelsToRun)[number]) => {
		try {
			await runTradeWorkflow({
				apiKey: model.lighterApiKey,
				modelName: model.openRouterModelName,
				name: model.name,
				invocationCount: model.invocationCount,
				id: model.id,
				accountIndex: model.accountIndex,
				totalMinutes: model.totalMinutes,
				variant: (model.variant as VariantId) ?? DEFAULT_VARIANT,
			});
			return { modelId: model.id, success: true as const };
		} catch (error) {
			console.error(`Model ${model.name} trade workflow failed:`, error);
			return { modelId: model.id, success: false as const, error };
		} finally {
			globalThis.modelsRunning?.set(model.id, false);
		}
	};

	// Run consensus workflow
	const runConsensus = async () => {
		if (!consensusModel || consensusIsRunning) {
			return null;
		}
		globalThis.modelsRunning?.set(consensusModel.id, true);
		try {
			console.log("[Consensus] Starting consensus workflow in parallel with models");
			await runConsensusWorkflow({
				apiKey: consensusModel.lighterApiKey,
				modelName: consensusModel.openRouterModelName,
				name: consensusModel.name,
				invocationCount: consensusModel.invocationCount,
				id: consensusModel.id,
				accountIndex: consensusModel.accountIndex,
				totalMinutes: consensusModel.totalMinutes,
				variant: (consensusModel.variant as VariantId) ?? DEFAULT_VARIANT,
			});
			return { modelId: consensusModel.id, success: true as const };
		} catch (error) {
			console.error("[Consensus] Consensus workflow failed:", error);
			return { modelId: consensusModel.id, success: false as const, error };
		} finally {
			globalThis.modelsRunning?.set(consensusModel.id, false);
		}
	};

	// Fire off all models AND consensus in parallel
	const allPromises: Promise<{ modelId: string; success: boolean } | null>[] = [
		...modelsToRun.map(runModel),
		// runConsensus(),
	];

	Promise.allSettled(allPromises).then((results) => {
		// Invalidate market cache after batch completes so next cycle gets fresh data
		invalidateMarketIntelligenceCache();

		const successful = results
			.filter(
				(r): r is PromiseFulfilledResult<{ modelId: string; success: true }> =>
					r.status === "fulfilled" && r.value !== null && r.value.success,
			)
			.map((r) => r.value.modelId);

		if (successful.length > 0) {
			emitBatchComplete(successful);
		}
	});
}

/**
 * Ensures the trade scheduler is running
 */
export function ensureTradeScheduler() {
	if (globalThis.tradeIntervalHandle) {
		return;
	}

	void executeScheduledTrades();

	globalThis.tradeIntervalHandle = setInterval(() => {
		void executeScheduledTrades();
	}, TRADE_INTERVAL_MS);
}

if ((import.meta as { main?: boolean }).main) {
	ensureTradeScheduler();
}
