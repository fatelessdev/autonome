/**
 * Trade Executor
 *
 * Orchestrates trade workflows using the modular agent architecture.
 * Scheduler logic has been removed — invocation is now triggered by Workflow DevKit steps.
 */

import { QueryClient } from "@tanstack/react-query";
import {
	ErrorDeduplicator,
	normalizeErrorMessage,
} from "@/core/lib/errorDeduplicator";
import { toCanonical } from "@/core/shared/markets/marketMetadata";
import type { VariantId } from "@/core/shared/variants";
import {
	isValidVariantId,
	TRADEABLE_VARIANT_IDS,
} from "@/core/shared/variants";
import { fallbackModel } from "@/env";
import {
	getAllOpenOrders,
	type OrderWithModel,
} from "@/server/db/ordersRepository.server";
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
import {
	getLeaderboardData,
	type LeaderboardEntry,
} from "@/server/features/analytics";
import {
	buildCompetitionSnapshot,
	type CompetitionSnapshot,
} from "@/server/features/trading/analysis/competitionSnapshot";
import {
	type CorrelationMatrix,
	type CorrelationWarning,
	computeCorrelationMatrix,
	generateCorrelationWarnings,
	invalidateCorrelationCache,
} from "@/server/features/trading/analysis/correlationMatrix";
import {
	calculatePerformanceMetrics,
	type PerformanceMetrics,
} from "@/server/features/trading/analysis/performanceMetrics";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { fetchLatestDecisionIndex } from "@/server/features/trading/contracts/decisionIndex";
import {
	buildInvocationResponsePayload,
	type InvocationClosedPositionSummary,
	type InvocationDecisionSummary,
	type InvocationExecutionResultSummary,
	type InvocationResponsePayload,
	type StepTelemetry,
} from "@/server/features/trading/contracts/invocationResponse";
import type { TradingDecisionWithContext } from "@/server/features/trading/contracts/tradingDecisions";
import {
	writeDecisionDiaryEntry,
	writeMarketStateEntry,
} from "@/server/features/trading/data/decisionDiaryService";
import type { MarketSnapshot } from "@/server/features/trading/data/marketData";
import {
	getCachedMarketIntelligence,
	getSharedMarketIntelligence,
	invalidateMarketIntelligenceCache,
} from "@/server/features/trading/data/marketIntelligenceCache";
import {
	attachStalenessScores,
	type EnrichedOpenPosition,
	type ExposureSummary,
	enrichOpenPositions,
	summarizePositionRisk,
} from "@/server/features/trading/data/openPositionEnrichment";
import type { PortfolioSnapshot } from "@/server/features/trading/data/portfolio";
import { portfolioQuery } from "@/server/features/trading/data/portfolio.server";
import { openPositionsQuery } from "@/server/features/trading/data/positions.server";
import { buildTradingPrompts } from "@/server/features/trading/prompting/promptBuilder";
import {
	getSharedNewsDigest,
	invalidateNewsCache,
} from "@/server/integrations/alpaca-news";
import type { OpenInterestMap } from "@/server/integrations/binance-oi";
import type { TaapiPreFetchResult } from "@/server/integrations/taapi";
import { createTradeAgent, type ToolContext } from "../agent";
import { reconcilePositions } from "../reconciliation";

const errorDedup = new ErrorDeduplicator();

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
	/** Pre-fetched leaderboard data for the base model's variant */
	leaderboardEntries?: LeaderboardEntry[];
}): Promise<FallbackCandidate[]> => {
	const leaderboard =
		params.leaderboardEntries ??
		(await getLeaderboardData("7d", params.baseModel.variant));
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

	if (candidates.length === 0 && fallbackModel) {
		candidates.push({
			id: "env:fallbackModel",
			reasoningModel: fallbackModel,
			source: "env",
		});
	}

	return candidates;
};

/**
 * Log-only alerting on fallback exhaustion.
 * Positions are preserved — no position closure on AI failure.
 */
const logFallbackExhaustion = (
	modelName: string,
	modelId: string,
	primaryFailures: number,
	fallbackFailures: number,
	lastError: unknown,
): void => {
	const errorMessage =
		lastError instanceof Error ? lastError.message : String(lastError);
	console.error(
		`[KillSwitch] ${modelName} (${modelId}) exhausted all fallback attempts. ` +
			`Primary failures: ${primaryFailures}, fallback failures: ${fallbackFailures}. ` +
			`Last error: ${errorMessage}. Positions preserved — no action taken.`,
	);
};

/** Options passed into runTradeWorkflow to avoid redundant per-model queries */
export interface TradeWorkflowOptions {
	/** Pre-fetched open orders from executeAllModelTrades scope */
	allOpenOrders: OrderWithModel[];
	/** Cached leaderboard data per variant (populated by executeAllModelTrades) */
	leaderboardCache: Map<VariantId, LeaderboardEntry[]>;
}

// ==========================================
// Decomposed workflow phases
// ==========================================

/** Shared helper: builds entry-time map and attaches staleness scores to positions. */
function enrichPositionsWithStaleness(
	positions: EnrichedOpenPosition[],
	allOpenOrders: OrderWithModel[],
	modelId: string,
): EnrichedOpenPosition[] {
	const entryTimeBySymbol = new Map<string, Date>();
	for (const order of allOpenOrders) {
		if (order.modelId !== modelId) continue;
		const canonical = toCanonical(order.symbol).toUpperCase();
		entryTimeBySymbol.set(canonical, order.openedAt);
	}
	return attachStalenessScores(
		positions.map((pos) => ({
			...pos,
			entryTime: entryTimeBySymbol.get(pos.symbol.toUpperCase()) ?? null,
		})),
	);
}

/** Aggregated context returned by prepareTradeContext(). */
interface TradeContext {
	portfolio: PortfolioSnapshot;
	openPositions: EnrichedOpenPosition[];
	openPositionsForPrompt: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
	marketIntelligence: {
		snapshots: MarketSnapshot[];
		taapiData: Map<string, TaapiPreFetchResult>;
		oiData: OpenInterestMap;
	};
	marketSnapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	newsDigest: string;
	correlationMatrix: CorrelationMatrix;
	correlationWarnings: CorrelationWarning[];
	currentTime: string;
	modelInvocation: { id: string };
	currentPortfolioValue: number;
	performanceMetrics: PerformanceMetrics;
	variantId: VariantId;
	competitionSnapshot: CompetitionSnapshot;
	capturedDecisions: InvocationDecisionSummary[];
	capturedExecutionResults: InvocationExecutionResultSummary[];
	capturedClosedPositions: InvocationClosedPositionSummary[];
	capturedStepTelemetry: StepTelemetry[];
	toolContext: ToolContext;
	enrichedPrompt: {
		systemPrompt: string;
		userPrompt: string;
		stateSummary: string;
	};
	rebuildUserPrompt: () => Promise<string>;
}

/** Result from executeAgent(). */
interface AgentResult {
	type: "success";
	text: string;
	responsePayload: InvocationResponsePayload;
	toolCallTelemetry: Array<{ toolName?: string; error?: unknown }>;
}

/** Phase 1: Fetch all context data, enrich positions, build prompts. */
async function prepareTradeContext(
	account: Account,
	options: TradeWorkflowOptions,
): Promise<TradeContext> {
	const { allOpenOrders, leaderboardCache } = options;
	const queryClient = new QueryClient();

	// Fetch initial data in parallel (open orders already hoisted to cycle scope)
	const [portfolio, openPositionsRaw, decisionIndex] = await Promise.all([
		queryClient.fetchQuery(portfolioQuery(account)),
		queryClient.fetchQuery(openPositionsQuery(account)),
		account.id
			? fetchLatestDecisionIndex(account.id)
			: Promise.resolve(new Map<string, TradingDecisionWithContext>()),
	]);

	const openPositions = enrichOpenPositions(openPositionsRaw, decisionIndex);
	const exposureSummary = summarizePositionRisk(openPositions);
	const openPositionsForPrompt = enrichPositionsWithStaleness(
		openPositions,
		allOpenOrders,
		account.id,
	);

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
	const marketIntelligence = {
		snapshots: marketResult.snapshots,
		taapiData: marketResult.taapiData,
		oiData: marketResult.oiData,
	};
	const marketSnapshots = marketResult.snapshots;
	const taapiData = marketResult.taapiData;
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
	const currentPortfolioValue = portfolio.totalValue;
	if (!Number.isFinite(currentPortfolioValue)) {
		throw new Error(
			`Invalid portfolio total for ${account.name}: ${portfolio.totalValue}`,
		);
	}
	const performanceMetrics = await calculatePerformanceMetrics(
		account,
		currentPortfolioValue,
	);

	const variantId = resolveVariantId(account.variant, `account ${account.id}`);

	// Leaderboard context (variant-scoped, pre-fetched at cycle level)
	const competitionSnapshot = await buildCompetitionSnapshot({
		modelId: account.id,
		variant: variantId,
		leaderboardEntries: leaderboardCache.get(variantId),
	});

	// Compute correlation matrix from market snapshots and generate warnings
	const correlationMatrix = computeCorrelationMatrix(marketResult.snapshots);
	const heldSymbols = new Set(openPositions.map((p) => p.symbol));
	const correlationWarnings = generateCorrelationWarnings(
		correlationMatrix,
		heldSymbols,
	);

	// Build prompts (uses staleness-enriched positions)
	const enrichedPrompt = buildTradingPrompts({
		account,
		portfolio,
		openPositions: openPositionsForPrompt,
		exposureSummary,
		performanceMetrics,
		marketIntelligence,
		newsDigest,
		currentTime,
		variant: variantId,
		competition: competitionSnapshot,
		correlationWarnings,
	});

	// Create tool context for shared state
	const toolContext: ToolContext = {
		account,
		invocationId: modelInvocation.id,
		openPositions,
		decisionIndex,
		actedSymbols,
		closedPositionCooldowns,
		capturedDecisions,
		capturedExecutionResults,
		capturedClosedPositions,
	};

	// Rebuild user prompt helper — uses outer-scope data for immutable context,
	// only refreshes portfolio, positions, and decisionIndex per step.
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
		const freshWithStaleness = enrichPositionsWithStaleness(
			freshPositions,
			allOpenOrders,
			account.id,
		);

		toolContext.openPositions = freshPositions;
		toolContext.decisionIndex = freshDecisionIndex;

		const freshPrompt = buildTradingPrompts({
			account,
			portfolio: freshPortfolio,
			openPositions: freshWithStaleness,
			exposureSummary: freshExposure,
			performanceMetrics,
			marketIntelligence,
			newsDigest,
			currentTime,
			variant: variantId,
			competition: competitionSnapshot,
		});

		return freshPrompt.stateSummary;
	};

	return {
		portfolio,
		openPositions,
		openPositionsForPrompt,
		exposureSummary,
		marketIntelligence,
		marketSnapshots,
		taapiData,
		newsDigest,
		correlationMatrix,
		correlationWarnings,
		currentTime,
		modelInvocation,
		currentPortfolioValue,
		performanceMetrics,
		variantId,
		competitionSnapshot,
		capturedDecisions,
		capturedExecutionResults,
		capturedClosedPositions,
		capturedStepTelemetry,
		toolContext,
		enrichedPrompt,
		rebuildUserPrompt,
	};
}

/** Phase 2: Create agent, generate, handle success/error. */
async function executeAgent(
	account: Account,
	ctx: TradeContext,
): Promise<AgentResult> {
	const { agent } = createTradeAgent({
		account,
		systemPrompt: ctx.enrichedPrompt.systemPrompt,
		toolContext: ctx.toolContext,
		onStepTelemetry: (telemetry) => ctx.capturedStepTelemetry.push(telemetry),
		rebuildUserPrompt: ctx.rebuildUserPrompt,
	});

	let result: Awaited<ReturnType<typeof agent.generate>>;
	try {
		result = await agent.generate({
			prompt: ctx.enrichedPrompt.userPrompt,
			abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
			options: {
				reasoningEffort: "high",
			},
		});
	} catch (error) {
		const failureMessage = `Trade workflow aborted: ${error instanceof Error ? error.message : String(error)}`;
		const normalizedError = normalizeErrorMessage(failureMessage);
		const dedupResult = errorDedup.shouldLog(normalizedError);
		if (dedupResult.shouldLog) {
			console.error(`[TradeAgent] ${account.name} execution failed`, error);
		} else {
			console.error(
				`[TradeAgent] ${account.name} execution failed (suppressed ${dedupResult.suppressedCount} duplicate(s))`,
			);
		}

		await incrementModelUsageMutation({
			modelId: account.id,
			deltas: { failedWorkflowCountDelta: 1 },
		});

		await updateInvocationMutation({
			id: ctx.modelInvocation.id,
			response: failureMessage,
			responsePayload: buildInvocationResponsePayload({
				prompt: ctx.enrichedPrompt.userPrompt,
				result: null,
				decisions: ctx.capturedDecisions,
				executionResults: ctx.capturedExecutionResults,
				closedPositions: ctx.capturedClosedPositions,
				stepTelemetry: ctx.capturedStepTelemetry,
			}),
		});

		await persistDiaryEntry(account, ctx, false);

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
		prompt: ctx.enrichedPrompt.userPrompt,
		result,
		decisions: ctx.capturedDecisions,
		executionResults: ctx.capturedExecutionResults,
		closedPositions: ctx.capturedClosedPositions,
		stepTelemetry: ctx.capturedStepTelemetry,
	});

	return {
		type: "success",
		text: responseText,
		responsePayload,
		toolCallTelemetry,
	};
}

/** Phase 3: Persist invocation results, diary entry, and emit events. */
async function persistResults(
	account: Account,
	ctx: TradeContext,
	agentResult: AgentResult,
): Promise<string> {
	await updateInvocationMutation({
		id: ctx.modelInvocation.id,
		response: agentResult.text,
		responsePayload: agentResult.responsePayload,
	});

	await persistDiaryEntry(account, ctx, true);
	await emitAllDataChanged(account.id);

	return agentResult.text;
}

/**
 * Write a DecisionDiary entry. Non-blocking on failure.
 * @param failedInvocation - true if called on a failed invocation (for logging context)
 */
async function persistDiaryEntry(
	account: Account,
	ctx: TradeContext,
	failedInvocation: boolean,
): Promise<void> {
	try {
		await writeDecisionDiaryEntry({
			modelId: account.id,
			invocationId: ctx.modelInvocation.id,
			variant: ctx.variantId,
			decisions: ctx.capturedDecisions,
			marketSnapshots: ctx.marketSnapshots,
			taapiData: ctx.taapiData,
			correlationMatrix: ctx.correlationMatrix,
			portfolioValue: ctx.currentPortfolioValue,
			cash: ctx.portfolio.availableCash,
			exposurePct:
				ctx.exposureSummary.totalNotional > 0
					? (ctx.exposureSummary.totalNotional / ctx.currentPortfolioValue) *
						100
					: 0,
			openPositionsCount: ctx.openPositionsForPrompt.length,
		});
	} catch (diaryError) {
		const suffix = failedInvocation ? " (failed invocation)" : "";
		console.error(
			`[DecisionDiary] Failed to write entry for ${account.name}${suffix}:`,
			diaryError,
		);
	}
}

/**
 * Runs a complete trade workflow for a single account.
 * Delegates to three phases: prepareTradeContext → executeAgent → persistResults.
 */
export async function runTradeWorkflow(
	account: Account,
	options: TradeWorkflowOptions,
): Promise<string> {
	const ctx = await prepareTradeContext(account, options);
	const agentResult = await executeAgent(account, ctx);
	return persistResults(account, ctx, agentResult);
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

	const validModels: Array<(typeof models)[number] & { variant: VariantId }> =
		[];

	for (const model of models) {
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

	// Hoist getAllOpenOrders to cycle scope — used by all runTradeWorkflow calls
	// and reconciliation. Eliminates N redundant DB queries per cycle.
	const allOpenOrders = await getAllOpenOrders();

	// Pre-fetch leaderboard data per variant to avoid redundant queries
	const leaderboardCache = new Map<VariantId, LeaderboardEntry[]>();
	for (const variant of TRADEABLE_VARIANT_IDS) {
		if (!leaderboardCache.has(variant)) {
			leaderboardCache.set(variant, await getLeaderboardData("7d", variant));
		}
	}

	const workflowOptions: TradeWorkflowOptions = {
		allOpenOrders,
		leaderboardCache,
	};

	const runModel = async (
		model: (typeof validModels)[number],
	): Promise<{ modelId: string; success: boolean }> => {
		const baseAccount = toTradingAccount(model);

		let primaryFailures = 0;
		let lastPrimaryError: unknown = null;
		for (let attempt = 1; attempt <= PRIMARY_MODEL_ATTEMPTS; attempt++) {
			try {
				await runTradeWorkflow(baseAccount, workflowOptions);
				return { modelId: model.id, success: true };
			} catch (error) {
				primaryFailures++;
				lastPrimaryError = error;
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const dedupResult = errorDedup.shouldLog(
					normalizeErrorMessage(errorMessage),
				);
				if (dedupResult.shouldLog) {
					console.error(
						`[TradeExecutor] Primary attempt ${attempt}/${PRIMARY_MODEL_ATTEMPTS} failed for ${model.name}:`,
						error,
					);
				} else {
					console.error(
						`[TradeExecutor] Primary attempt ${attempt}/${PRIMARY_MODEL_ATTEMPTS} failed for ${model.name} (suppressed ${dedupResult.suppressedCount} duplicate(s))`,
					);
				}
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
			leaderboardEntries: leaderboardCache.get(model.variant),
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
					await runTradeWorkflow(fallbackAccount, workflowOptions);
					return { modelId: model.id, success: true };
				} catch (error) {
					fallbackFailures++;
					const fbErrorMessage =
						error instanceof Error ? error.message : String(error);
					const fbDedupResult = errorDedup.shouldLog(
						normalizeErrorMessage(fbErrorMessage),
					);
					if (fbDedupResult.shouldLog) {
						console.error(
							`[TradeExecutor] Fallback failure ${fallbackFailures} for ${model.name} using ${candidate.id}:`,
							error,
						);
					} else {
						console.error(
							`[TradeExecutor] Fallback failure ${fallbackFailures} for ${model.name} using ${candidate.id} (suppressed ${fbDedupResult.suppressedCount} duplicate(s))`,
						);
					}

					if (fallbackFailures >= FALLBACK_FAILURE_KILL_SWITCH_THRESHOLD) {
						logFallbackExhaustion(
							model.name,
							model.id,
							primaryFailures,
							fallbackFailures,
							error,
						);
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

	// Reconcile DB orders against Alpaca positions after all trades complete
	// Use hoisted allOpenOrders from cycle scope
	await Promise.all(
		validModels.map(async (model) => {
			try {
				const account = toTradingAccount(model);
				const reconciliationResult = await reconcilePositions(
					account,
					allOpenOrders,
				);
				if (reconciliationResult.orphanedClosed > 0) {
					console.warn(
						`[Reconciliation] ${model.name}: ${reconciliationResult.orphanedClosed} orphaned order(s) closed`,
					);
				}
			} catch (error) {
				const reconcErrorMessage =
					error instanceof Error ? error.message : String(error);
				const reconcDedupResult = errorDedup.shouldLog(
					normalizeErrorMessage(reconcErrorMessage),
				);
				if (reconcDedupResult.shouldLog) {
					console.error(`[Reconciliation] Failed for ${model.name}:`, error);
				} else {
					console.error(
						`[Reconciliation] Failed for ${model.name} (suppressed ${reconcDedupResult.suppressedCount} duplicate(s))`,
					);
				}
			}
		}),
	);

	// Write MarketState entries for each model after trade cycle completes
	const cachedMarket = getCachedMarketIntelligence();
	if (cachedMarket) {
		const correlationMatrix = computeCorrelationMatrix(cachedMarket.snapshots);
		await Promise.all(
			validModels.map(async (model) => {
				try {
					await writeMarketStateEntry({
						modelId: model.id,
						marketSnapshots: cachedMarket.snapshots,
						taapiData: cachedMarket.taapiData,
						correlationMatrix,
						oiData: cachedMarket.oiData,
					});
				} catch (marketStateError) {
					// Non-blocking: market state write failure should not break the cycle
					console.error(
						`[MarketState] Failed to write entry for ${model.name}:`,
						marketStateError,
					);
				}
			}),
		);
	}

	// Invalidate market and correlation caches after batch completes
	invalidateMarketIntelligenceCache();
	invalidateCorrelationCache();
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
