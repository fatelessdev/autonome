/**
 * Trade Executor
 *
 * Orchestrates trade workflows using the modular agent architecture.
 * Scheduler logic has been removed — invocation is now triggered by Workflow DevKit steps.
 */

import { QueryClient } from "@tanstack/react-query";
import { isValidVariantId } from "@/core/shared/variants";
import { fallback_model } from "@/env";

import { listModels } from "@/server/db/tradingRepository";
import {
	createInvocationMutation,
	incrementModelUsageMutation,
	updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import {
	emitAllDataChanged,
	emitBatchComplete,
} from "@/server/events/workflowEvents";
import { getLeaderboardData } from "@/server/features/analytics";
import { buildCompetitionSnapshot } from "@/server/features/trading/analysis/competitionSnapshot";
import { calculatePerformanceMetrics } from "@/server/features/trading/analysis/performanceMetrics";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { fetchLatestDecisionIndex } from "@/server/features/trading/contracts/decisionIndex";
import {
	buildInvocationResponsePayload,
	type InvocationClosedPositionSummary,
	type InvocationDecisionSummary,
	type InvocationExecutionResultSummary,
	type StepTelemetry,
} from "@/server/features/trading/contracts/invocationResponse";
import type { TradingDecisionWithContext } from "@/server/features/trading/contracts/tradingDecisions";
import {
	getSharedMarketIntelligence,
	invalidateMarketIntelligenceCache,
} from "@/server/features/trading/data/marketIntelligenceCache";
import {
	enrichOpenPositions,
	summarizePositionRisk,
} from "@/server/features/trading/data/openPositionEnrichment";
import { portfolioQuery } from "@/server/features/trading/data/portfolio.server";
import { getOpenPositions } from "@/server/features/trading/data/positions";
import { openPositionsQuery } from "@/server/features/trading/data/positions.server";
import { closePosition } from "@/server/features/trading/execution/closePosition";
import {
	isConsensusModel,
	prepareConsensusWorkflowFromModels,
} from "@/server/features/trading/execution/orchestrator";
import { buildTradingPrompts } from "@/server/features/trading/prompting/promptBuilder";
import type { VariantId } from "@/server/features/trading/prompting/prompts/variants";
import {
	getSharedNewsDigest,
	invalidateNewsCache,
} from "@/server/integrations/alpaca-news";
import { TRADEABLE_VARIANT_IDS } from "@/shared/variants";

import { createTradeAgent, type ToolContext } from "../agent";

/** Result returned from runTradeWorkflow for outer timeout handling */
export interface TradeWorkflowResult {
	response: string;
	invocationId: string;
}

const AGENT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per agent call
const PRIMARY_MODEL_ATTEMPTS = 2;
const FALLBACK_MODEL_ATTEMPTS = 2;
const FALLBACK_FAILURE_KILL_SWITCH_THRESHOLD = 2;

type WorkflowExecutionError = Error & {
	transient?: boolean;
};

interface FallbackCandidate {
	id: string;
	reasoningModel: string;
	source: "leaderboard" | "env";
}

const resolveVariantId = (variant: unknown, context: string): VariantId => {
	if (!isValidVariantId(variant)) {
		throw new Error(`Invalid or missing variant for ${context}`);
	}
	return variant;
};

const isTransientExecutionError = (error: unknown): boolean => {
	const withTransient = error as WorkflowExecutionError | null;
	if (withTransient?.transient === true) {
		return true;
	}

	const message =
		error instanceof Error
			? `${error.message} ${(error.cause as Error | undefined)?.message ?? ""}`
			: String(error);
	const lower = message.toLowerCase();

	return [
		"timeout",
		"timed out",
		"abort",
		"rate limit",
		"429",
		"503",
		"502",
		"504",
		"temporarily unavailable",
		"network",
		"socket",
		"econn",
		"enotfound",
		"fetch failed",
	].some((token) => lower.includes(token));
};

const toTradingAccount = (model: {
	id: string;
	name: string;
	openRouterModelName: string;
	alpacaApiKey: string;
	alpacaApiSecret: string;
	invocationCount: number;
	totalMinutes: number;
	variant: VariantId;
}): Account => ({
	alpacaApiKey: model.alpacaApiKey,
	alpacaApiSecret: model.alpacaApiSecret,
	modelName: model.openRouterModelName,
	name: model.name,
	invocationCount: model.invocationCount,
	id: model.id,
	totalMinutes: model.totalMinutes,
	variant: model.variant,
});

const resolveFallbackCandidates = async (params: {
	baseModel: {
		id: string;
		name: string;
		openRouterModelName: string;
		variant: VariantId;
	};
	validModels: Array<{
		id: string;
		openRouterModelName: string;
		variant: VariantId;
	}>;
}): Promise<FallbackCandidate[]> => {
	const leaderboard = await getLeaderboardData("7d", params.baseModel.variant);
	const sorted = [...leaderboard].sort((a, b) => b.pnlPercent - a.pnlPercent);
	const validById = new Map(
		params.validModels.map((model) => [model.id, model]),
	);

	const candidates: FallbackCandidate[] = [];
	for (const entry of sorted) {
		if (entry.modelId === params.baseModel.id) continue;
		const model = validById.get(entry.modelId);
		if (!model) continue;
		if (model.variant !== params.baseModel.variant) continue;
		candidates.push({
			id: model.id,
			reasoningModel: model.openRouterModelName,
			source: "leaderboard",
		});
		if (candidates.length === 2) break;
	}

	if (candidates.length === 0 && fallback_model) {
		candidates.push({
			id: "env:fallback_model",
			reasoningModel: fallback_model,
			source: "env",
		});
	}

	return candidates;
};

const triggerKillSwitch = async (account: Account): Promise<void> => {
	const openPositions = await getOpenPositions(account);
	if (openPositions.length === 0) {
		console.warn(
			`[KillSwitch] No open positions for ${account.name} (${account.id})`,
		);
		return;
	}

	const symbols = [
		...new Set(openPositions.map((position) => position.symbol)),
	];
	console.error(
		`[KillSwitch] Closing ${symbols.length} position(s) for ${account.name} (${account.id})`,
	);
	await closePosition(account, symbols);
};

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
	const closedPositionCooldowns = new Map<
		string,
		{ side: "LONG" | "SHORT"; cooldownUntil: string }
	>();
	const symbolActionCounts = new Map<string, number>();

	// Fetch shared market data (cached across all models in the same cycle)
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
	const marketIntelligence = marketResult.formatted;
	const newsDigest = newsResult.formatted;

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
	if (!Number.isFinite(currentPortfolioValue)) {
		throw new Error(
			`Invalid portfolio total for ${account.name}: ${portfolio.total}`,
		);
	}
	const performanceMetrics = await calculatePerformanceMetrics(
		account,
		currentPortfolioValue,
	);

	const variantId = resolveVariantId(account.variant, `account ${account.id}`);

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
					: Promise.resolve(new Map<string, TradingDecisionWithContext>()),
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
		console.error(`[TradeAgent] ${account.name} execution failed`, error);

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

		const wrappedError = new Error(failureMessage, {
			cause: error instanceof Error ? error : undefined,
		}) as WorkflowExecutionError;
		wrappedError.transient = isTransientExecutionError(error);
		throw wrappedError;
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

	// Consensus is intentionally prepared-only for now.
	const consensusPlan = prepareConsensusWorkflowFromModels(models);
	if (consensusPlan) {
		console.log(
			`[TradeExecutor] Consensus account ready with ${consensusPlan.voterCount} voters (execution disabled in cycle)`,
		);
	}

	const regularModels = models.filter((m) => !isConsensusModel(m.name));

	const validModels: Array<
		(typeof regularModels)[number] & { variant: VariantId }
	> = [];

	for (const model of regularModels) {
		if (!model.alpacaApiKey || !model.alpacaApiSecret) {
			console.warn(`Model ${model.id} missing Alpaca credentials; skipping`);
			continue;
		}

		if (!isValidVariantId(model.variant)) {
			console.warn(
				`[TradeExecutor] Skipping ${model.name}: invalid or missing variant`,
			);
			continue;
		}

		const variant = model.variant;
		if (!TRADEABLE_VARIANT_IDS.includes(variant)) {
			console.log(
				`[TradeExecutor] Skipping ${model.name}: variant "${variant}" is not tradeable`,
			);
			continue;
		}

		validModels.push({ ...model, variant });
	}

	if (validModels.length === 0) {
		return { successCount: 0, failureCount: 0, totalModels: 0 };
	}

	const runModel = async (
		model: (typeof validModels)[number],
	): Promise<{ modelId: string; success: boolean }> => {
		const baseAccount = toTradingAccount(model);

		let primaryFailures = 0;
		let lastPrimaryError: unknown = null;
		for (let attempt = 1; attempt <= PRIMARY_MODEL_ATTEMPTS; attempt++) {
			try {
				await runTradeWorkflow(baseAccount);
				return { modelId: model.id, success: true };
			} catch (error) {
				primaryFailures++;
				lastPrimaryError = error;
				console.error(
					`[TradeExecutor] Primary attempt ${attempt}/${PRIMARY_MODEL_ATTEMPTS} failed for ${model.name}:`,
					error,
				);
			}
		}

		if (!isTransientExecutionError(lastPrimaryError)) {
			console.error(
				`[TradeExecutor] ${model.name} failed with non-transient error; fallback skipped`,
			);
			return { modelId: model.id, success: false };
		}

		const fallbackCandidates = await resolveFallbackCandidates({
			baseModel: model,
			validModels,
		});

		if (fallbackCandidates.length === 0) {
			console.error(
				`[TradeExecutor] ${model.name} has no eligible fallback reasoning model`,
			);
			return { modelId: model.id, success: false };
		}

		let fallbackFailures = 0;
		for (const candidate of fallbackCandidates) {
			const fallbackAccount: Account = {
				...baseAccount,
				modelName: candidate.reasoningModel,
			};

			for (let attempt = 1; attempt <= FALLBACK_MODEL_ATTEMPTS; attempt++) {
				try {
					console.warn(
						`[TradeExecutor] Fallback attempt ${attempt}/${FALLBACK_MODEL_ATTEMPTS} for ${model.name} using ${candidate.source} candidate ${candidate.id} (${candidate.reasoningModel})`,
					);
					await runTradeWorkflow(fallbackAccount);
					return { modelId: model.id, success: true };
				} catch (error) {
					fallbackFailures++;
					console.error(
						`[TradeExecutor] Fallback failure ${fallbackFailures} for ${model.name} using ${candidate.id}:`,
						error,
					);

					if (fallbackFailures >= FALLBACK_FAILURE_KILL_SWITCH_THRESHOLD) {
						try {
							await triggerKillSwitch(baseAccount);
						} catch (killSwitchError) {
							console.error(
								`[KillSwitch] Failed for ${model.name}:`,
								killSwitchError,
							);
						}
						return { modelId: model.id, success: false };
					}

					if (!isTransientExecutionError(error)) {
						break;
					}
				}
			}
		}

		if (primaryFailures > 0) {
			console.error(
				`[TradeExecutor] ${model.name} failed after ${primaryFailures} primary attempt(s) and ${fallbackFailures} fallback failure(s)`,
			);
		}

		return { modelId: model.id, success: false };
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
		successCount === totalModels ? "✅" : successCount > 0 ? "⚠️" : "❌";
	console.log(
		`[TradeExecutor] Cycle complete: ${status} ${successCount}/${totalModels} models succeeded`,
	);

	return { successCount, failureCount, totalModels };
}
