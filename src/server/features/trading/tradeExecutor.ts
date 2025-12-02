import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { QueryClient } from "@tanstack/react-query";
import { ToolLoopAgent, tool, stepCountIs } from "ai";
import z from "zod";
import { listModels, ToolCallType } from "@/server/db/tradingRepository";
import {
	createInvocationMutation,
	createToolCallMutation,
	incrementModelUsageMutation,
	updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import {
	getOpenOrderBySymbol,
	updateOrderExitPlan,
} from "@/server/db/ordersRepository.server";
import { DEFAULT_SIMULATOR_OPTIONS, env, IS_SIMULATION_ENABLED } from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { Account } from "@/server/features/trading/accounts";
import { closePosition } from "@/server/features/trading/closePosition";
import { createPosition } from "@/server/features/trading/createPosition";
import { fetchPositions } from "@/server/features/trading/queries.server";
import { fetchLatestDecisionIndex } from "@/server/features/trading/decisionIndex";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";
import {
	buildInvocationResponsePayload,
	type InvocationClosedPositionSummary,
	type InvocationDecisionSummary,
	type InvocationExecutionResultSummary,
} from "@/server/features/trading/invocationResponse";
import { formatMarketSnapshots } from "@/server/features/trading/marketData";
import { marketSnapshotsQuery } from "@/server/features/trading/marketData.server";
import {
	computeRiskMetrics,
	enrichOpenPositions,
	resolveNotionalUsd,
	resolveQuantity,
	summarizePositionRisk,
} from "@/server/features/trading/openPositionEnrichment";
import type {
	ExitPlanSummary,
	OpenPositionSummary,
} from "@/server/features/trading/openPositions";
import { openPositionsQuery } from "@/server/features/trading/openPositions.server";
import { calculatePerformanceMetrics } from "@/server/features/trading/performanceMetrics";
import { buildTradingPrompts } from "@/server/features/trading/promptBuilder";
import type {
	TradingDecisionWithContext,
	TradingSignal,
} from "@/server/features/trading/tradingDecisions";
import { MARKETS } from "@/shared/markets/marketMetadata";
import { getModelProvider } from "@/shared/models/modelConfig";
import {
	emitAllDataChanged,
	emitBatchComplete,
} from "@/server/events/workflowEvents";
import { analyzeToolCallFailure } from "@/server/features/analytics/toolCallAnalyzer";

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

export async function runTradeWorkflow(account: Account) {
	const queryClient = new QueryClient();

	const [portfolio, openPositionsRaw, decisionIndex] = await Promise.all([
		queryClient.fetchQuery(portfolioQuery(account)),
		queryClient.fetchQuery(openPositionsQuery(account)),
		account.id
			? fetchLatestDecisionIndex(account.id)
			: Promise.resolve(new Map<string, TradingDecisionWithContext>()),
	]);

	const openPositions = enrichOpenPositions(openPositionsRaw, decisionIndex);
	const exposureSummary = summarizePositionRisk(openPositions);

	const capturedDecisions: InvocationDecisionSummary[] = [];
	const capturedExecutionResults: InvocationExecutionResultSummary[] = [];
	const capturedClosedPositions: InvocationClosedPositionSummary[] = [];

	// Track symbols acted on this session to prevent duplicate actions from dumb models
	const actedSymbols = new Set<string>();

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
		console.error("Failed to assemble market intelligence", error);
	}

	const currentTime = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Kolkata",
		hour: "2-digit",
		minute: "2-digit",
		hour12: true,
	}).format(new Date());

	const modelInvocation = await createInvocationMutation(account.id);

	// Portfolio snapshots are recorded by the dedicated scheduler (priceTracker.ts)
	// to avoid duplicates - no need to create one here

	const currentPortfolioValue = parseFloat(portfolio.total);
	const performanceMetrics = await calculatePerformanceMetrics(
		account,
		currentPortfolioValue,
	);

	const enrichedPrompt = buildTradingPrompts({
		account,
		portfolio,
		openPositions,
		exposureSummary,
		performanceMetrics,
		marketIntelligence,
		currentTime,
	});

	const marketSymbols = Object.keys(MARKETS) as [
		keyof typeof MARKETS,
		...(keyof typeof MARKETS)[],
	];

	const decisionSchema = z.object({
		symbol: z
			.enum(Object.keys(MARKETS) as [string, ...string[]])
			.describe("Trading pair symbol (e.g., BTC, ETH, SOL)"),
		side: z
			.enum(["LONG", "SHORT", "HOLD"])
			.describe("Trade direction"),
		quantity: z
			.number()
			.describe("Position size calculated from 2% risk rule"),
		leverage: z
			.number()
			.describe("Leverage 1-10x"),
		profit_target: z
			.number()
			.describe("Take profit price level"),
		stop_loss: z
			.number()
			.describe("Stop loss price level"),
		invalidation_condition: z
			.string()
			.describe("When to exit if thesis breaks"),
		confidence: z
			.number()
			.describe("Setup quality 0-100"),
	});

	const nim = createOpenAICompatible({
		name: "nim",
		baseURL: "https://integrate.api.nvidia.com/v1",
		headers: {
			Authorization: `Bearer ${env.NIM_API_KEY}`,
		},
		// fetch: async (url, options) => {
		// 	if (options.method === 'POST' && options.body) {
		// 		const body = JSON.parse(options.body as string);

		// 		// INJECT YOUR CUSTOM PARAMETERS HERE
		// 		body.chat_template_kwargs = { thinking: true };

		// 		options.body = JSON.stringify(body);
		// 	}
		// 	return fetch(url, options);
		// },
	});
	const openrouter = createOpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
	});

	const modelProvider = getModelProvider(account.name);
	const useOpenRouter = modelProvider === "openrouter";
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const selectedModel = (useOpenRouter
		? openrouter(account.modelName)
		: nim.chatModel(account.modelName)) as any;

	const tradeAgent = new ToolLoopAgent({
		model: selectedModel,
		instructions: enrichedPrompt.systemPrompt,
		// Stop after 10 steps maximum to prevent infinite loops
		stopWhen: stepCountIs(10),
		toolChoice: "auto",
		// Override toolChoice for models that don't support "required"
		providerOptions: {
			// nim: {
			// 	chat_template_kwargs: { thinking: true }
			// },
			openrouter: {
				reasoning: {
					effort: 'high',
					exclude: false, // Set true to hide thinking from final output
				}
			},
		},
		prepareStep: () => {
			const modelId = account.modelName.toLowerCase();

			// Models that don't support "required" tool choice
			const autoToolModels = ["glm-4", "minimax-m2", "kimi-k2", "gpt-oss", "qwen3-next", "deepseek-r1"];
			const requiresAutoToolChoice = autoToolModels.some(id => modelId.includes(id));

			// Build typed configuration, merging providerOptions instead of replacing
			return {
				...(requiresAutoToolChoice && { toolChoice: "auto" as const }),
			};
		},
		tools: {
			createPosition: tool({
				description: "Open one or more positions atomically",
				inputSchema: z.object({
					decisions: z.array(decisionSchema),
				}),
				execute: async ({ decisions }) => {
					const modern =
						decisions?.map((item) => ({
							symbol: item.symbol.toUpperCase(),
							side:
								item.side === "SHORT" || item.side === "LONG"
									? item.side
									: item.side === "HOLD"
										? "HOLD"
										: (item.side as string),
							quantity: item.quantity,
							leverage: item.leverage ?? null,
							profitTarget: item.profit_target ?? null,
							stopLoss: item.stop_loss ?? null,
							invalidationCondition: item.invalidation_condition ?? null,
							confidence: item.confidence ?? null,
						})) ?? [];

					const normalized: {
						symbol: string;
						side: "LONG" | "SHORT" | "HOLD";
						quantity: number;
						leverage: number | null;
						profitTarget: number | null;
						stopLoss: number | null;
						invalidationCondition: string | null;
						confidence: number | null;
					}[] = [];
					const seenSymbols = new Set<string>();
					const skippedDuplicates: string[] = [];

					for (const entry of [...modern]) {
						const symbol = entry.symbol;

						// Check if already acted on this symbol this session
						if (actedSymbols.has(symbol)) {
							skippedDuplicates.push(symbol);
							continue;
						}

						const sideRaw =
							typeof entry.side === "string"
								? entry.side.toUpperCase()
								: "HOLD";
						const validSide =
							sideRaw === "LONG" || sideRaw === "SHORT" ? sideRaw : "HOLD";
						const quantity = Number.isFinite(entry.quantity)
							? entry.quantity
							: 0;

						if (!(symbol in MARKETS)) continue;
						if (seenSymbols.has(symbol)) continue;
						seenSymbols.add(symbol);

						normalized.push({
							symbol,
							side: validSide,
							quantity,
							leverage: entry.leverage ?? null,
							profitTarget: entry.profitTarget ?? null,
							stopLoss: entry.stopLoss ?? null,
							invalidationCondition: entry.invalidationCondition ?? null,
							confidence: entry.confidence ?? null,
						});
					}

					// Return early if all symbols were duplicates
					if (normalized.length === 0 && skippedDuplicates.length > 0) {
						return `Already acted on ${skippedDuplicates.join(", ")} this session. Call 'holding' if done.`;
					}

					const results = await createPosition(account, normalized);

					const successful = results.filter((r) => r.success);
					const failed = results.filter((r) => !r.success);

					// Mark successful symbols as acted
					for (const result of successful) {
						actedSymbols.add(result.symbol);
					}

					for (const decision of normalized) {
						capturedDecisions.push({
							symbol: decision.symbol,
							side: decision.side,
							quantity: decision.quantity,
							leverage: decision.leverage,
							profitTarget: decision.profitTarget,
							stopLoss: decision.stopLoss,
							invalidationCondition: decision.invalidationCondition,
							confidence: decision.confidence,
						});
					}

					for (const outcome of results) {
						capturedExecutionResults.push({
							symbol: outcome.symbol,
							side: outcome.side,
							quantity: outcome.quantity,
							leverage: outcome.leverage ?? null,
							success: outcome.success,
							error: outcome.error ?? null,
						});
					}

					await createToolCallMutation({
						invocationId: modelInvocation.id,
						type: ToolCallType.CREATE_POSITION,
						metadata: JSON.stringify({
							decisions: normalized,
							results,
						}),
					});

					const formatDecision = (r: (typeof results)[number]) => {
						const pieces = [r.symbol];
						if (r.side === "HOLD") {
							pieces.push("HOLD");
						} else {
							pieces.push(r.side);
						}
						if (Number.isFinite(r.quantity)) {
							pieces.push(`qty ${Math.abs(r.quantity ?? 0).toPrecision(3)}`);
						}
						if (Number.isFinite(r.leverage ?? undefined)) {
							pieces.push(`${r.leverage}x`);
						}
						return pieces.join(" ");
					};

					let response = "";
					if (successful.length > 0) {
						response += `Successfully processed: ${successful.map(formatDecision).join(", ")}. `;
					}
					if (failed.length > 0) {
						response += `Failed: ${failed
							.map(
								(r) => `${formatDecision(r)} (${r.error ?? "unknown error"})`,
							)
							.join(", ")}. `;
					}
					if (skippedDuplicates.length > 0) {
						response += `Skipped (already acted): ${skippedDuplicates.join(", ")}.`;
					}

					return response || "No positions were created";
				},
			}),
			closePosition: tool({
				description: "Close one or more open positions",
				inputSchema: z.object({
					symbols: z
						.array(z.enum(marketSymbols as unknown as [string, ...string[]]))
						.describe("Symbols to close"),
				}),
				execute: async ({ symbols }) => {
					// Filter out already-acted symbols
					const skippedDuplicates: string[] = [];
					const symbolsToClose = symbols.filter((s) => {
						const upper = s.toUpperCase();
						if (actedSymbols.has(upper)) {
							skippedDuplicates.push(upper);
							return false;
						}
						return true;
					});

					if (symbolsToClose.length === 0 && skippedDuplicates.length > 0) {
						return `Already acted on ${skippedDuplicates.join(", ")} this session. Call 'holding' if done.`;
					}

					const closedPositions = await closePosition(account, symbolsToClose);

					// Mark closed symbols as acted
					for (const pos of closedPositions) {
						actedSymbols.add(pos.symbol);
					}

					await createToolCallMutation({
						invocationId: modelInvocation.id,
						type: ToolCallType.CLOSE_POSITION,
						metadata: JSON.stringify({ symbols: symbolsToClose, closedPositions }),
					});

					for (const position of closedPositions) {
						capturedClosedPositions.push({
							symbol: position.symbol,
							side: position.side,
							quantity: position.quantity,
							entryPrice: position.entryPrice,
							exitPrice: position.exitPrice,
							netPnl: position.netPnl,
							realizedPnl: position.realizedPnl,
							unrealizedPnl: position.unrealizedPnl,
							closedAt: position.closedAt ?? null,
						});
					}

					let response = closedPositions.length > 0
						? `Closed: ${closedPositions.map((p) => `${p.symbol} (${p.side})`).join(", ")}.`
						: "No positions were closed.";

					if (skippedDuplicates.length > 0) {
						response += ` Skipped (already acted): ${skippedDuplicates.join(", ")}.`;
					}

					return response;
				},
			}),
			updateExitPlan: tool({
				description: "Tighten stops/targets without widening risk",
				inputSchema: z.object({
					updates: z
						.array(
							z.object({
								symbol: z.enum(
									marketSymbols as unknown as [string, ...string[]],
								),
								new_stop_loss: z
									.number()
									.describe("New stop price (must tighten, not widen)"),
								new_target_price: z
									.number()
									.optional()
									.nullable()
									.describe("Optional new target"),
								reason: z
									.string()
									.min(3)
									.describe("Per-symbol justification"),
							}),
						)
						.min(1),
				}),
				execute: async ({ updates }) => {
					const decisionsPayload: Array<{
						symbol: string;
						signal: TradingSignal;
						quantity: number;
						profitTarget: number | null;
						stopLoss: number | null;
						invalidationCondition: string | null;
						leverage: number | null;
						confidence: number | null;
						reason: string | null;
					}> = [];
					const resultsPayload: Array<{
						symbol: string;
						success: boolean;
						error?: string | null;
					}> = [];
					const successSummaries: string[] = [];
					const failureSummaries: string[] = [];
					const skippedDuplicates: string[] = [];
					const nowIso = new Date().toISOString();
					let simulatorInstance: ExchangeSimulator | null = null;

					for (const update of updates) {
						const normalizedSymbol = update.symbol.toUpperCase();

						// Check if already acted on this symbol
						if (actedSymbols.has(normalizedSymbol)) {
							skippedDuplicates.push(normalizedSymbol);
							continue;
						}

						const position = openPositions.find(
							(pos) => pos.symbol?.toUpperCase() === normalizedSymbol,
						);

						if (!position) {
							const message = `No open position found for ${normalizedSymbol}.`;
							resultsPayload.push({
								symbol: normalizedSymbol,
								success: false,
								error: message,
							});
							failureSummaries.push(message);
							continue;
						}

						if (
							!Number.isFinite(update.new_stop_loss) ||
							update.new_stop_loss <= 0
						) {
							const message = `Invalid stop provided for ${normalizedSymbol}.`;
							resultsPayload.push({
								symbol: normalizedSymbol,
								success: false,
								error: message,
							});
							failureSummaries.push(message);
							continue;
						}

						const stopValue = Number(update.new_stop_loss);
						const currentStop = position.exitPlan?.stop ?? null;
						const tolerance = 1e-6;

						if (currentStop !== null) {
							if (
								position.sign === "LONG" &&
								stopValue + tolerance < currentStop
							) {
								const message = `Rejected: new stop widens risk (current ${currentStop.toFixed(4)}).`;
								resultsPayload.push({
									symbol: normalizedSymbol,
									success: false,
									error: message,
								});
								failureSummaries.push(message);
								continue;
							}
							if (
								position.sign === "SHORT" &&
								stopValue - tolerance > currentStop
							) {
								const message = `Rejected: new stop widens risk (current ${currentStop.toFixed(4)}).`;
								resultsPayload.push({
									symbol: normalizedSymbol,
									success: false,
									error: message,
								});
								failureSummaries.push(message);
								continue;
							}
						}

						const targetValue =
							typeof update.new_target_price === "number" &&
								Number.isFinite(update.new_target_price)
								? Number(update.new_target_price)
								: (position.exitPlan?.target ?? null);

						const updatedExitPlan: ExitPlanSummary = {
							target: targetValue,
							stop: stopValue,
							invalidation: update.reason,
						};

						position.exitPlan = updatedExitPlan;
						const basePosition = position as OpenPositionSummary;
						const notional =
							position.notionalUsd ?? resolveNotionalUsd(basePosition);
						const recalculatedRisk = computeRiskMetrics(
							basePosition,
							updatedExitPlan,
							notional,
						);
						position.riskUsd = recalculatedRisk.riskUsd;
						position.riskPercent = recalculatedRisk.riskPercent;
						position.rewardUsd = recalculatedRisk.rewardUsd;
						position.rewardPercent = recalculatedRisk.rewardPercent;
						position.riskRewardRatio = recalculatedRisk.riskRewardRatio;
						position.lastDecisionAt = nowIso;
						position.decisionStatus = "UPDATED";

						const decisionQuantity = resolveQuantity(basePosition) ?? 0;

						if (IS_SIMULATION_ENABLED) {
							simulatorInstance =
								simulatorInstance ??
								(await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS));
							const accountId = account.id || "default";
							simulatorInstance.setExitPlan(accountId, normalizedSymbol, {
								stop: updatedExitPlan.stop,
								target: updatedExitPlan.target,
								invalidation: updatedExitPlan.invalidation,
							});
						}

						// Update exitPlan in Orders table (single source of truth)
						try {
							const accountId = account.id || "default";
							const dbOrder = await getOpenOrderBySymbol(accountId, normalizedSymbol);
							if (dbOrder) {
								await updateOrderExitPlan({
									orderId: dbOrder.id,
									exitPlan: {
										stop: updatedExitPlan.stop,
										target: updatedExitPlan.target,
										invalidation: updatedExitPlan.invalidation,
										confidence: position.confidence ?? null,
									},
								});
							}
						} catch (dbError) {
							console.error(`[updateExitPlan] DB update failed for ${normalizedSymbol}:`, dbError);
						}

						capturedDecisions.push({
							symbol: normalizedSymbol,
							side: position.sign,
							quantity: decisionQuantity,
							leverage: position.leverage ?? null,
							profitTarget: updatedExitPlan.target,
							stopLoss: updatedExitPlan.stop,
							invalidationCondition: updatedExitPlan.invalidation,
							confidence: position.confidence ?? null,
						});

						decisionsPayload.push({
							symbol: normalizedSymbol,
							signal: position.sign as TradingSignal,
							quantity: decisionQuantity,
							profitTarget: updatedExitPlan.target,
							stopLoss: updatedExitPlan.stop,
							invalidationCondition: updatedExitPlan.invalidation,
							leverage: position.leverage ?? null,
							confidence: position.confidence ?? null,
							reason: update.reason,
						});

						resultsPayload.push({ symbol: normalizedSymbol, success: true });
						actedSymbols.add(normalizedSymbol);
						successSummaries.push(
							`${normalizedSymbol} → stop ${stopValue.toFixed(4)}${typeof updatedExitPlan.target === "number"
								? `, target ${updatedExitPlan.target.toFixed(4)}`
								: ""
							}`,
						);
					}

					// Return early if all were duplicates
					if (decisionsPayload.length === 0 && skippedDuplicates.length > 0) {
						return `Already acted on ${skippedDuplicates.join(", ")} this session. Call 'holding' if done.`;
					}

					if (decisionsPayload.length > 0) {
						const toolCallRecord = await createToolCallMutation({
							invocationId: modelInvocation.id,
							type: ToolCallType.CREATE_POSITION,
							metadata: JSON.stringify({
								action: "updateExitPlan",
								decisions: decisionsPayload,
								results: resultsPayload,
							}),
						});

						for (const decision of decisionsPayload) {
							decisionIndex.set(decision.symbol, {
								symbol: decision.symbol,
								signal: decision.signal,
								quantity: decision.quantity,
								leverage: decision.leverage,
								profitTarget: decision.profitTarget,
								stopLoss: decision.stopLoss,
								invalidationCondition: decision.invalidationCondition,
								confidence: decision.confidence,
								toolCallId: toolCallRecord.id,
								toolCallType: "UPDATE_EXIT_PLAN",
								createdAt: toolCallRecord.createdAt,
								result: { symbol: decision.symbol, success: true },
							});
						}
					}

					if (successSummaries.length === 0 && failureSummaries.length === 0) {
						return skippedDuplicates.length > 0
							? `Skipped (already acted): ${skippedDuplicates.join(", ")}. Call 'holding' if done.`
							: "No exit plan updates were applied.";
					}

					const responseChunks: string[] = [];
					if (successSummaries.length > 0) {
						responseChunks.push(`Updated ${successSummaries.join("; ")}.`);
					}
					if (failureSummaries.length > 0) {
						responseChunks.push(failureSummaries.join(" "));
					}
					if (skippedDuplicates.length > 0) {
						responseChunks.push(`Skipped (already acted): ${skippedDuplicates.join(", ")}.`);
					}

					return (
						responseChunks.join(" ") || "No exit plan updates were applied."
					);
				},
			}),
			// holding: tool({
			// 	description: "Explicitly pass when no trading action is warranted this session",
			// 	inputSchema: z.object({
			// 		reason: z
			// 			.string()
			// 			.max(200)
			// 			.describe("Why no action: primary constraint or market condition"),
			// 	}),
			// 	execute: async ({ reason }) => {
			// 		// No DB recording needed - this is just a structured pass action
			// 		return `Holding: ${reason}`;
			// 	},
			// }),
		},

	});

	const AGENT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
	const MAX_RETRIES = 2;

	const executeWithRetry = async (): Promise<Awaited<ReturnType<typeof tradeAgent.generate>>> => {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

			try {
				const result = await tradeAgent.generate({
					prompt: enrichedPrompt.userPrompt,
					abortSignal: controller.signal,
				});
				clearTimeout(timeoutId);
				return result;
			} catch (error) {
				clearTimeout(timeoutId);
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if this is a retryable error
				const isTimeout = controller.signal.aborted || lastError.name === "TimeoutError";
				const isServerError = lastError.message.includes("500") || lastError.message.includes("502");
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

		// Should never reach here, but TypeScript needs this
		throw lastError ?? new Error("Unknown error in retry loop");
	};

	let result: Awaited<ReturnType<typeof tradeAgent.generate>>;
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
			}),
		});

		return failureMessage;
	}

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
	});


	await updateInvocationMutation({
		id: modelInvocation.id,
		response: responseText,
		responsePayload,
	});

	// Analyze tool call failures with Codestral
	// Fire and forget - don't block workflow completion
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

	// Refresh positions to emit SSE update after any position changes
	await fetchPositions();

	// Emit unified workflow event - clients will refetch via oRPC
	await emitAllDataChanged(account.id);

	return responseText;
}

export async function executeScheduledTrades() {
	const models = await listModels();
	const validModels = models.filter((model) => {
		if (!model.lighterApiKey) {
			console.warn(
				`Model ${model.id} missing lighterApiKey; skipping scheduled trade`,
			);
			return false;
		}
		return true;
	});

	if (validModels.length === 0) {
		return;
	}

	// Filter out models that are still running from previous cycle
	const modelsToRun = validModels.filter((model) => {
		const isRunning = globalThis.modelsRunning?.get(model.id) ?? false;
		return !isRunning;
	});

	if (modelsToRun.length === 0) {
		return;
	}

	// Mark models as running
	for (const model of modelsToRun) {
		globalThis.modelsRunning?.set(model.id, true);
	}

	// Run models in parallel - each completes independently
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
			});
			return { modelId: model.id, success: true as const };
		} catch (error) {
			console.error(`Model ${model.name} trade workflow failed:`, error);
			return { modelId: model.id, success: false as const, error };
		} finally {
			// Always mark model as no longer running
			globalThis.modelsRunning?.set(model.id, false);
		}
	};

	// Fire off all models in parallel, don't block scheduler
	Promise.allSettled(modelsToRun.map(runModel)).then((results) => {
		const successful = results
			.filter(
				(r): r is PromiseFulfilledResult<{ modelId: string; success: true }> =>
					r.status === "fulfilled" && r.value.success,
			)
			.map((r) => r.value.modelId);

		if (successful.length > 0) {
			emitBatchComplete(successful);
		}
	});
}

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
