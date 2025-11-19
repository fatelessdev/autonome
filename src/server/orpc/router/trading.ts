import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { parseSymbols } from "@/shared/formatting/numberFormat";
import {
	CryptoPricesInputSchema,
	CryptoPricesResponseSchema,
	PortfolioHistoryResponseSchema,
	PositionsResponseSchema,
	TradesResponseSchema,
} from "../schema";

// ==================== Trades ====================

export const getTrades = os
	.input(z.object({}))
	.output(TradesResponseSchema)
	.handler(async () => {
		return Sentry.startSpan({ name: "getTrades" }, async () => {
			try {
				const result = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchTrades());
				// Transform the result to match the expected schema
				const trades = (result || []).map((trade: any) => ({
					id: trade.id || "",
					modelId: trade.modelId || "",
					modelName: trade.modelName || "",
					modelRouterName: trade.modelRouterName || undefined,
					modelKey: trade.modelKey || trade.modelId || "",
					side:
						trade.side &&
						typeof trade.side === "string" &&
						trade.side.toLowerCase() === "short"
							? "short"
							: "long",
					symbol: trade.symbol || "",
					entryPrice:
						typeof trade.entryPrice === "number" ? trade.entryPrice : 0,
					exitPrice: typeof trade.exitPrice === "number" ? trade.exitPrice : 0,
					quantity: typeof trade.quantity === "number" ? trade.quantity : 0,
					entryNotional:
						typeof trade.entryNotional === "number" ? trade.entryNotional : 0,
					exitNotional:
						typeof trade.exitNotional === "number" ? trade.exitNotional : 0,
					netPnl: typeof trade.netPnl === "number" ? trade.netPnl : 0,
					openedAt:
						typeof trade.openedAt === "string"
							? trade.openedAt
							: new Date().toISOString(),
					closedAt:
						typeof trade.closedAt === "string"
							? trade.closedAt
							: new Date().toISOString(),
					holdingTime:
						typeof trade.holdingTime === "string"
							? trade.holdingTime
							: undefined,
					timestamp:
						typeof trade.timestamp === "string"
							? trade.timestamp
							: new Date().toISOString(),
				}));
				return { trades };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error("Failed to fetch trades");
			}
		});
	});

// ==================== Positions ====================

export const getPositions = os
	.input(z.object({}))
	.output(PositionsResponseSchema)
	.handler(async () => {
		return Sentry.startSpan({ name: "getPositions" }, async () => {
			try {
				const result = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchPositions());
				// Transform the result to match the expected schema
				const positions = (result || []).map((modelPos: any) => ({
					modelId: modelPos.modelId || "",
					modelName: modelPos.modelName || "",
					modelLogo:
						typeof modelPos.modelLogo === "string"
							? modelPos.modelLogo
							: undefined,
					positions: Array.isArray(modelPos.positions)
						? modelPos.positions.map((pos: any) => ({
								symbol: typeof pos.symbol === "string" ? pos.symbol : "",
								side:
									pos.side &&
									typeof pos.side === "string" &&
									pos.side.toLowerCase() === "short"
										? "short"
										: "long",
								quantity: typeof pos.quantity === "number" ? pos.quantity : 0,
								entryPrice:
									typeof pos.entryPrice === "number" ? pos.entryPrice : 0,
								currentPrice:
									typeof pos.currentPrice === "number"
										? pos.currentPrice
										: undefined,
								unrealizedPnl:
									typeof pos.unrealizedPnl === "number"
										? pos.unrealizedPnl
										: undefined,
								exitPlan:
									pos.exitPlan && typeof pos.exitPlan === "object"
										? {
												target:
													typeof pos.exitPlan.target === "number"
														? pos.exitPlan.target
														: undefined,
												stop:
													typeof pos.exitPlan.stop === "number"
														? pos.exitPlan.stop
														: undefined,
												invalidation:
													pos.exitPlan.invalidation &&
													typeof pos.exitPlan.invalidation === "object"
														? {
																enabled:
																	typeof pos.exitPlan.invalidation.enabled ===
																	"boolean"
																		? pos.exitPlan.invalidation.enabled
																		: false,
																message:
																	typeof pos.exitPlan.invalidation.message ===
																	"string"
																		? pos.exitPlan.invalidation.message
																		: undefined,
															}
														: undefined,
											}
										: undefined,
								signal: typeof pos.signal === "string" ? pos.signal : undefined,
								leverage:
									typeof pos.leverage === "number" ? pos.leverage : undefined,
								confidence:
									typeof pos.confidence === "number"
										? pos.confidence
										: undefined,
								lastDecisionAt:
									typeof pos.lastDecisionAt === "string"
										? pos.lastDecisionAt
										: undefined,
								decisionStatus:
									typeof pos.decisionStatus === "string"
										? pos.decisionStatus
										: undefined,
							}))
						: [],
					totalUnrealizedPnl:
						typeof modelPos.totalUnrealizedPnl === "number"
							? modelPos.totalUnrealizedPnl
							: undefined,
					availableCash:
						typeof modelPos.availableCash === "number"
							? modelPos.availableCash
							: undefined,
				}));
				return { positions };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error("Failed to fetch positions");
			}
		});
	});

// ==================== Crypto Prices ====================

export const getCryptoPrices = os
	.input(CryptoPricesInputSchema)
	.output(CryptoPricesResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getCryptoPrices" }, async () => {
			const symbols = input.symbols || [];
			const normalizedSymbols = parseSymbols(symbols.join(","));

			try {
				const result = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchCryptoPrices(normalizedSymbols));
				// Transform the result to match the expected schema
				const prices = (result || [])
					.map((price: any) => ({
						symbol: typeof price.symbol === "string" ? price.symbol : "",
						price: typeof price.price === "number" ? price.price : 0,
						message:
							typeof price.message === "string" ? price.message : undefined,
					}))
					.filter(
						(price: any) => typeof price.symbol === "string" && price.symbol,
					);
				return { prices };
			} catch (error) {
				Sentry.captureException(error);
				return { prices: [] };
			}
		});
	});

// ==================== Portfolio History ====================

export const getPortfolioHistory = os
	.input(z.object({}))
	.output(PortfolioHistoryResponseSchema)
	.handler(async () => {
		return Sentry.startSpan({ name: "getPortfolioHistory" }, async () => {
			try {
				const result = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchPortfolioHistory());
				// Transform the result to match the expected schema
				const history = (result || []).map((entry: any) => ({
					id: typeof entry.id === "string" ? entry.id : "",
					modelId: typeof entry.modelId === "string" ? entry.modelId : "",
					netPortfolio:
						typeof entry.netPortfolio === "string" ? entry.netPortfolio : "",
					createdAt:
						typeof entry.createdAt === "string"
							? entry.createdAt
							: new Date().toISOString(),
					updatedAt:
						typeof entry.updatedAt === "string"
							? entry.updatedAt
							: new Date().toISOString(),
					model:
						entry.model && typeof entry.model === "object"
							? {
									name:
										typeof entry.model.name === "string"
											? entry.model.name
											: "",
									openRouterModelName:
										typeof entry.model.openRouterModelName === "string"
											? entry.model.openRouterModelName
											: undefined,
								}
							: undefined,
				}));
				return history;
			} catch (error) {
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error
						? error.message
						: "Unknown error while fetching portfolio history",
				);
			}
		});
	});
