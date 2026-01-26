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
} from "@/server/features/trading/prompts/variants";
import {
	emitAllDataChanged,
	emitBatchComplete,
} from "@/server/events/workflowEvents";
import { analyzeToolCallFailure } from "@/server/features/analytics/toolCallAnalyzer";
import {
	CONSENSUS_MODEL_NAME,
} from "@/server/features/trading/orchestrator";
import {
	getTradeIntervalHandle,
	setTradeIntervalHandle,
	setTradeLastRun,
	setTradeLastSuccessfulCompletion,
	setTradeLastCycleStats,
	incrementConsecutiveFailedCycles,
	resetConsecutiveFailedCycles,
	isModelRunning,
	setModelRunning,
	clearStaleRunningModels,
} from "@/server/schedulers/schedulerState";

import { createTradeAgent, type ToolContext } from "./agent";

/** Result returned from runTradeWorkflow for outer timeout handling */
export interface TradeWorkflowResult {
	response: string;
	invocationId: string;
}

/**
 * Tracks pending invocations by model ID.
 * This allows the outer timeout handler to update the invocation record
 * when runTradeWorkflow is killed before it can clean up.
 */
const pendingInvocations = new Map<string, string>(); // modelId -> invocationId

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

	// Track cooldowns from closed positions (for flip-after-close enforcement)
	const closedPositionCooldowns = new Map<string, { side: "LONG" | "SHORT"; cooldownUntil: string }>();

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

	// Create invocation record and track it for outer timeout handling
	const modelInvocation = await createInvocationMutation(account.id);
	pendingInvocations.set(account.id, modelInvocation.id);

	// Helper to clean up pending tracking
	const clearPending = () => pendingInvocations.delete(account.id);

	// Calculate performance metrics
	const currentPortfolioValue = parseFloat(portfolio.total);
	const performanceMetrics = await calculatePerformanceMetrics(
		account,
		currentPortfolioValue,
	);

	// Get variant config for temperature and other settings
	const variantId = account.variant ?? DEFAULT_VARIANT;
	// const variantConfig = getVariantConfig(variantId);

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
		closedPositionCooldowns,
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

		clearPending();
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
	// analyzeToolCallFailure({
	// 	modelId: account.id,
	// 	invocationId: modelInvocation.id,
	// 	responseText,
	// 	isError: false,
	// 	toolCalls: toolCallTelemetry,
	// 	decisions: capturedDecisions,
	// 	closedPositions: capturedClosedPositions,
	// }).catch((err) => {
	// 	console.warn("Tool call analysis failed:", err);
	// });

	// Refresh positions to emit SSE update
	await fetchPositions();

	// Emit unified workflow event
	await emitAllDataChanged(account.id);

	clearPending();
	return responseText;
}

/**
 * Executes scheduled trades for all valid models
 * Wrapped in try-catch to prevent scheduler from stopping
 */
export async function executeScheduledTrades() {
	try {
		setTradeLastRun(Date.now());
		await executeScheduledTradesInternal();
	} catch (error) {
		console.error("[Trade Scheduler] Unhandled error in executeScheduledTrades:", error);
		// Don't rethrow - scheduler must continue
	}
}

/**
 * Internal implementation of scheduled trade execution
 */
async function executeScheduledTradesInternal() {
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

	// Clear stale running states (models stuck for >10 minutes)
	const STALE_THRESHOLD_MS = 10 * 60 * 1000;
	clearStaleRunningModels(STALE_THRESHOLD_MS);

	// Filter out models that are still running from previous cycle
	const modelsToRun = validModels.filter((model) => {
		return !isModelRunning(model.id);
	});

	// Check if consensus is already running
	const consensusIsRunning = consensusModel
		? isModelRunning(consensusModel.id)
		: false;

	if (modelsToRun.length === 0 && (!consensusModel || consensusIsRunning)) {
		return;
	}

	// Mark models as running with timestamps
	for (const model of modelsToRun) {
		setModelRunning(model.id, true);
	}

	// Hard timeout for each model run - ensures every promise settles
	// Set to 9 minutes (just under the 10-min stale threshold)
	const MODEL_RUN_TIMEOUT_MS = 9 * 60 * 1000;

	// Run regular model workflow with timeout wrapper
	const runModel = async (model: (typeof modelsToRun)[number]): Promise<{ modelId: string; success: boolean }> => {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("Model run timed out after 9 minutes")), MODEL_RUN_TIMEOUT_MS);
		});

		try {
			await Promise.race([
				runTradeWorkflow({
					apiKey: model.lighterApiKey,
					modelName: model.openRouterModelName,
					name: model.name,
					invocationCount: model.invocationCount,
					id: model.id,
					accountIndex: model.accountIndex,
					totalMinutes: model.totalMinutes,
					variant: (model.variant as VariantId) ?? DEFAULT_VARIANT,
				}),
				timeoutPromise,
			]);
			return { modelId: model.id, success: true };
		} catch (error) {
			const isTimeout = error instanceof Error && error.message.includes("timed out");
			console.error(`[Trade Scheduler] Model ${model.name} ${isTimeout ? "timed out" : "failed"}:`, error);

			// Check for pending invocation that needs cleanup
			// This happens when outer timeout fires before runTradeWorkflow completes
			const pendingInvocationId = pendingInvocations.get(model.id);
			if (pendingInvocationId) {
				const errorMessage = isTimeout
					? "Model run timed out after 9 minutes (outer timeout)"
					: `Trade workflow aborted: ${error instanceof Error ? error.message : String(error)}`;

				try {
					await updateInvocationMutation({
						id: pendingInvocationId,
						response: errorMessage,
						responsePayload: buildInvocationResponsePayload({
							prompt: "[Outer timeout - prompt not captured]",
							result: null,
							decisions: [],
							executionResults: [],
							closedPositions: [],
							stepTelemetry: [],
						}),
					});
					console.log(`[Trade Scheduler] Updated orphaned invocation ${pendingInvocationId} for ${model.name}`);
				} catch (updateError) {
					console.error(`[Trade Scheduler] Failed to update orphaned invocation:`, updateError);
				}
				pendingInvocations.delete(model.id);
			}

			return { modelId: model.id, success: false };
		} finally {
			setModelRunning(model.id, false);
		}
	};

	// Fire off all models in parallel - DON'T await, let them run independently
	// The per-model timeout ensures they all settle within 9 minutes
	// This allows the next 5-min cycle to start on schedule
	const totalModels = modelsToRun.length;
	
	Promise.allSettled(modelsToRun.map(runModel)).then((results) => {
		// Invalidate market cache after batch completes so next cycle gets fresh data
		invalidateMarketIntelligenceCache();

		// Track success/failure metrics
		const validResults = results.filter(
			(r): r is PromiseFulfilledResult<{ modelId: string; success: boolean }> =>
				r.status === "fulfilled",
		);
		const successCount = validResults.filter((r) => r.value.success).length;
		const failureCount = validResults.length - successCount;

		// Update cycle stats
		setTradeLastCycleStats({
			successCount,
			failureCount,
			totalModels,
			timestamp: Date.now(),
		});

		// Track consecutive failed cycles (all models failed)
		if (successCount === 0 && totalModels > 0) {
			incrementConsecutiveFailedCycles();
		} else if (successCount > 0) {
			resetConsecutiveFailedCycles();
			setTradeLastSuccessfulCompletion(Date.now());
		}

		const successful = validResults
			.filter((r) => r.value.success)
			.map((r) => r.value.modelId);

		if (successful.length > 0) {
			emitBatchComplete(successful);
		}

		// Log cycle summary
		if (totalModels > 0) {
			const status = successCount === totalModels ? "✅" : successCount > 0 ? "⚠️" : "❌";
			console.log(
				`[Trade Scheduler] Cycle complete: ${status} ${successCount}/${totalModels} models succeeded`,
			);
		}
	});
}

/**
 * Ensures the trade scheduler is running
 */
export function ensureTradeScheduler() {
	if (getTradeIntervalHandle()) {
		return;
	}

	console.log("[Trade Scheduler] Starting trade executor...");

	void executeScheduledTrades();

	setTradeIntervalHandle(setInterval(() => {
		void executeScheduledTrades();
	}, TRADE_INTERVAL_MS));
}

if ((import.meta as { main?: boolean }).main) {
	ensureTradeScheduler();
}
