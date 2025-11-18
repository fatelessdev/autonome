import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { QueryClient } from "@tanstack/react-query";
import { ToolLoopAgent, tool } from "ai";
import z from "zod";
import { listModels, ToolCallType } from "@/server/db/tradingRepository";
import {
  createInvocationMutation,
  createPortfolioSnapshotMutation,
  createToolCallMutation,
  incrementModelUsageMutation,
  updateInvocationMutation,
} from "@/server/db/tradingRepository.server";
import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { Account } from "@/server/features/trading/accounts";
import { closePosition } from "@/server/features/trading/closePosition";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";
import { createPosition } from "@/server/features/trading/createPosition";
import { fetchLatestDecisionIndex } from "@/server/features/trading/decisionIndex";
import { emitTradingEvent } from "@/server/features/trading/events/tradingEvents";
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
import { buildTradingPrompt } from "@/server/features/trading/promptBuilder";
import type {
  TradingDecisionWithContext,
  TradingSignal,
} from "@/server/features/trading/tradingDecisions";
import { MARKETS } from "@/shared/markets/marketMetadata";

declare global {
  // eslint-disable-next-line no-var
  var tradeIntervalHandle: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var tradeIntervalRunning: boolean | undefined;
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

  await createPortfolioSnapshotMutation({
    modelId: account.id,
    netPortfolio: portfolio.total,
  });
  await queryClient.invalidateQueries({
    queryKey: ["portfolio-history", account.id],
  });

  const currentPortfolioValue = parseFloat(portfolio.total);
  const performanceMetrics = await calculatePerformanceMetrics(
    account,
    currentPortfolioValue,
  );

  const enrichedPrompt = buildTradingPrompt({
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
      .describe("The symbol to open the position at"),
    side: z
      .enum(["LONG", "SHORT", "HOLD"])
      .describe("Trading signal: LONG, SHORT, or HOLD"),
    quantity: z.number().describe("Signed quantity for the decision."),
    leverage: z.number(),
    profit_target: z.number(),
    stop_loss: z.number(),
    invalidation_condition: z
      .string()
      .describe("Condition under which the position should be invalidated"),
    confidence: z.number(),
  });
  console.log(enrichedPrompt);

  const nim = createOpenAICompatible({
    name: "nim",
    baseURL: "https://integrate.api.nvidia.com/v1",
    headers: {
      Authorization: `Bearer ${process.env.NIM_API_KEY}`,
    },
  });
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  const _model = nim.chatModel(account.modelName);

  const toolChoiceMode: "auto" | "required" = "auto";
  // const toolChoiceMode: 'auto' | 'required' = 'required'; // Enable during focused QA to force tool invocations.

  const tradeAgent = new ToolLoopAgent({
    model: openrouter(account.modelName),
    // All tools behave identically for live accounts and simulation mode.
    providerOptions: {
      createOpenAICompatible: {
        reasoningEffort: "high",
      },
    },
    tools: {
      createPosition: tool({
        description: "Open one or more positions in the given markets",
        inputSchema: z
          .object({
            decisions: z.array(decisionSchema),
          })
          .superRefine((value, ctx) => {
            if (!value.decisions) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide a decisions array with trading instructions.",
              });
            }
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

          for (const entry of [...modern]) {
            const sideRaw =
              typeof entry.side === "string"
                ? entry.side.toUpperCase()
                : "HOLD";
            const validSide =
              sideRaw === "LONG" || sideRaw === "SHORT" ? sideRaw : "HOLD";
            const quantity = Number.isFinite(entry.quantity)
              ? entry.quantity
              : 0;
            const symbol = entry.symbol;

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

          const results = await createPosition(account, normalized);

          const successful = results.filter((r) => r.success);
          const failed = results.filter((r) => !r.success);

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

          if (successful.length > 0) {
            console.log(
              `✓ Opened positions: ${successful.map((r) => r.symbol).join(", ")}`,
            );
          }
          if (failed.length > 0) {
            console.log(
              `✗ Failed: ${failed.map((r) => `${r.symbol} (${r.error})`).join(", ")}`,
            );
          }

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
              .join(", ")}`;
          }

          return response || "No positions were created";
        },
      }),
      closePosition: tool({
        description:
          "Close one or more currently open positions for the provided market symbols",
        inputSchema: z.object({
          symbols: z
            .array(z.enum(marketSymbols as unknown as [string, ...string[]]))
            .describe("Array of symbols whose open positions should be closed"),
        }),
        execute: async ({ symbols }) => {
          const closedPositions = await closePosition(account, symbols);
          await createToolCallMutation({
            invocationId: modelInvocation.id,
            type: ToolCallType.CLOSE_POSITION,
            metadata: JSON.stringify({ symbols, closedPositions }),
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
          const summaryText = closedPositions
            .map((trade) => {
              const side = trade.side === "LONG" ? "LONG" : "SHORT";
              const qty =
                trade.quantity != null ? trade.quantity.toFixed(4) : "?";
              return `${trade.symbol} (${side}) x ${qty}`;
            })
            .join(", ");

          console.log(
            `Position(s) for ${symbols.join(", ")} closed successfully`,
          );
          return summaryText.length > 0
            ? `Closed positions: ${summaryText}`
            : `Position(s) for ${symbols.join(", ")} closed successfully`;
        },
      }),
      updateExitPlan: tool({
        description:
          "Tighten existing stops and optionally adjust targets without widening risk.",
        inputSchema: z.object({
          updates: z
            .array(
              z.object({
                symbol: z.enum(
                  marketSymbols as unknown as [string, ...string[]],
                ),
                new_stop_loss: z
                  .number()
                  .describe("Updated stop price that tightens risk."),
                new_target_price: z
                  .number()
                  .optional()
                  .nullable()
                  .describe("Optional profit target."),
                reason: z
                  .string()
                  .min(3)
                  .describe("Short justification for the adjustment."),
              }),
            )
            .min(1, "Provide at least one exit plan update."),
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
          const nowIso = new Date().toISOString();
          let simulatorInstance: ExchangeSimulator | null = null;

          for (const update of updates) {
            const normalizedSymbol = update.symbol.toUpperCase();
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
            successSummaries.push(
              `${normalizedSymbol} → stop ${stopValue.toFixed(4)}${
                typeof updatedExitPlan.target === "number"
                  ? `, target ${updatedExitPlan.target.toFixed(4)}`
                  : ""
              }`,
            );
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
            return "No exit plan updates were applied.";
          }

          const responseChunks: string[] = [];
          if (successSummaries.length > 0) {
            responseChunks.push(`Updated ${successSummaries.join("; ")}.`);
          }
          if (failureSummaries.length > 0) {
            responseChunks.push(failureSummaries.join(" "));
          }

          return (
            responseChunks.join(" ") || "No exit plan updates were applied."
          );
        },
      }),
    },
    toolChoice: toolChoiceMode,
  });

  let result: Awaited<ReturnType<typeof tradeAgent.generate>>;
  try {
    result = await tradeAgent.generate({
      prompt: enrichedPrompt,
    });
  } catch (error) {
    const failureMessage = `Trade workflow aborted: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.error("Trade agent execution failed", error);

    await updateInvocationMutation({
      id: modelInvocation.id,
      response: failureMessage,
      responsePayload: buildInvocationResponsePayload({
        prompt: enrichedPrompt,
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
    prompt: enrichedPrompt,
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
  await refreshConversationEvents();
  console.log(responseText);
  emitTradingEvent({
    type: "workflow:complete",
    modelId: account.id,
    timestamp: new Date().toISOString(),
  });
  return responseText;
}

export async function executeScheduledTrades() {
  if (globalThis.tradeIntervalRunning) {
    return;
  }

  globalThis.tradeIntervalRunning = true;

  try {
    const models = await listModels();
    const processedModels: string[] = [];

    for (const model of models) {
      if (!model.lighterApiKey) {
        console.warn(
          `Model ${model.id} missing lighterApiKey; skipping scheduled trade`,
        );
        continue;
      }

      await runTradeWorkflow({
        apiKey: model.lighterApiKey,
        modelName: model.openRouterModelName,
        name: model.name,
        invocationCount: model.invocationCount,
        id: model.id,
        accountIndex: model.accountIndex,
        totalMinutes: model.totalMinutes,
      });
      processedModels.push(model.id);
    }

    if (processedModels.length > 0) {
      emitTradingEvent({
        type: "batch:complete",
        modelIds: processedModels,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Scheduled trade execution failed", error);
  } finally {
    globalThis.tradeIntervalRunning = false;
  }
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
