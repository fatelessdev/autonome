import { ExchangeSimulator } from "@//server/features/simulator/exchangeSimulator";
import {
	API_KEY_INDEX,
	BASE_URL,
	DEFAULT_SIMULATOR_OPTIONS,
	IS_SIMULATION_ENABLED,
} from "@/env";
import type { OrderSide } from "@/server/features/simulator/types";
import type { Account } from "@/server/features/trading/accounts";
import {
	SignerClientFactory,
	SignerClient,
} from "@/server/features/trading/signerClient";
import { MARKETS } from "@/shared/markets/marketMetadata";
import { fetchCandlesticksRest } from "@/server/integrations/lighter";
import {
	createOrder,
	getOpenOrderBySymbol,
	scaleIntoOrder,
} from "@/server/db/ordersRepository.server";
import { placeSlTpOrders, cancelSlTpOrders } from "./slTpOrderManager";

export interface PositionRequest {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	confidence: number | null;
	/** Optional: link to the tool call that created this position */
	toolCallId?: string;
}

export interface PositionResult {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	entryPrice?: number;
	success: boolean;
	error?: string;
	/** The database order ID for this position */
	orderId?: string;
}

export async function createPosition(
	account: Account,
	positions: PositionRequest[],
): Promise<PositionResult[]> {
	if (!positions || positions.length === 0) {
		return [];
	}

	if (IS_SIMULATION_ENABLED) {
		const simulator = await ExchangeSimulator.bootstrap(
			DEFAULT_SIMULATOR_OPTIONS,
		);
		const accountId = account.id || "default";
		const results: PositionResult[] = [];

		for (const {
			symbol,
			side,
			quantity,
			leverage,
			confidence,
			profitTarget,
			stopLoss,
			invalidationCondition,
		} of positions) {
			if (side === "HOLD") {
				results.push({ symbol, side, quantity, leverage, success: true });
				continue;
			}

			const orderSide: OrderSide = side === "LONG" ? "buy" : "sell";
			const orderQuantity = Math.abs(quantity);
			try {
				const execution = await simulator.placeOrder(
					{
						symbol,
						side: orderSide,
						quantity: orderQuantity,
						type: "market",
						leverage: leverage ?? undefined,
						confidence: confidence ?? undefined,
						exitPlan: {
							stop: stopLoss ?? null,
							target: profitTarget ?? null,
							invalidation: invalidationCondition ?? null,
						},
					},
					accountId,
					{ skipValidation: false },
				);

				if (execution.status === "rejected" || execution.totalQuantity === 0) {
					results.push({
						symbol,
						side,
						quantity,
						leverage,
						success: false,
						error: execution.reason ?? "Order rejected",
					});
				} else {
					const entryPrice = execution.averagePrice ?? 0;
					// Use the actual filled quantity, not the requested quantity
					const filledQuantity = execution.totalQuantity;

					// Check for existing open order to scale into
					try {
						const existingOrder = await getOpenOrderBySymbol(
							accountId,
							symbol.toUpperCase(),
						);

						if (existingOrder && existingOrder.side === side) {
							// Scale into existing position using weighted avg formula
							const prevQty = parseFloat(existingOrder.quantity);
							const prevEntry = parseFloat(existingOrder.entryPrice);
							const newQty = filledQuantity;
							const prevNotional = prevEntry * prevQty;
							const newNotional = entryPrice * newQty;
							const totalQty = prevQty + newQty;
							const newAvgEntry =
								totalQty !== 0
									? (prevNotional + newNotional) / totalQty
									: entryPrice;

							// When scaling in, new exit plan values REPLACE old ones (not fallback)
							// AI provides fresh analysis, so use new values when provided
							const updatedOrder = await scaleIntoOrder({
								orderId: existingOrder.id,
								additionalQuantity: newQty.toString(),
								newEntryPrice: entryPrice.toString(),
								newAvgEntryPrice: newAvgEntry.toString(),
								exitPlan: {
									stop: stopLoss ?? existingOrder.exitPlan?.stop ?? null,
									target: profitTarget ?? existingOrder.exitPlan?.target ?? null,
									invalidation: invalidationCondition ?? existingOrder.exitPlan?.invalidation ?? null,
									invalidationPrice: existingOrder.exitPlan?.invalidationPrice ?? null,
									confidence: confidence ?? existingOrder.exitPlan?.confidence ?? null,
									timeExit: existingOrder.exitPlan?.timeExit ?? null,
									cooldownUntil: existingOrder.exitPlan?.cooldownUntil ?? null,
								},
							});

							results.push({
								symbol,
								side,
								quantity: totalQty,
								leverage,
								entryPrice: newAvgEntry,
								success: true,
								orderId: updatedOrder.id,
							});
						} else {
							// Create new order (either no existing position or opposite side)
							const dbOrder = await createOrder({
								modelId: accountId,
								symbol: symbol.toUpperCase(),
								side,
								quantity: filledQuantity.toString(),
								entryPrice: entryPrice.toString(),
								leverage: leverage?.toString() ?? null,
							exitPlan: {
								stop: stopLoss ?? null,
								target: profitTarget ?? null,
								invalidation: invalidationCondition ?? null,
								invalidationPrice: null,
								confidence: confidence ?? null,
								timeExit: null,
								cooldownUntil: null,
							},
							});

							results.push({
								symbol,
								side,
								quantity: filledQuantity,
								leverage,
								entryPrice,
								success: true,
								orderId: dbOrder.id,
							});
						}
					} catch (dbError) {
						console.error(
							`[createPosition] DB persist failed for ${symbol}:`,
							dbError,
						);
						// Still return success since the order was executed
						results.push({
							symbol,
							side,
							quantity: filledQuantity,
							leverage,
							entryPrice,
							success: true,
						});
					}
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: message,
				});
			}
		}

		return results;
	}

	// Live trading mode - use SignerClient from new SDK
	const client = await SignerClientFactory.create({
		url: BASE_URL,
		privateKey: account.apiKey,
		apiKeyIndex: API_KEY_INDEX,
		accountIndex: Number(account.accountIndex),
	});

	const results: PositionResult[] = [];

	for (const {
		symbol,
		side,
		quantity,
		leverage,
		profitTarget,
		stopLoss,
		invalidationCondition,
		confidence,
	} of positions) {
		try {
			const market = MARKETS[symbol as keyof typeof MARKETS];
			if (!market) {
				console.warn(`Market for symbol ${symbol} not found, skipping`);
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: "Market not found",
				});
				continue;
			}

			if (side === "HOLD") {
				results.push({ symbol, side, quantity, leverage, success: true });
				continue;
			}

			// Fetch latest price using REST API directly
			const candles = await fetchCandlesticksRest({
				market_id: market.marketId,
				resolution: "1m",
				start_timestamp: Date.now() - 1000 * 60 * 5,
				end_timestamp: Date.now(),
				count_back: 1,
			});
			const latestPrice = candles?.[candles.length - 1]?.close;
			if (!latestPrice) {
				console.warn(`No latest price found for ${symbol}, skipping`);
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: "No latest price available",
				});
				continue;
			}

			const latestPriceNum = typeof latestPrice === 'number' ? latestPrice : parseFloat(String(latestPrice));
			const directionIsLong = side === "LONG";
			const orderQuantity = Math.abs(quantity);

			// Execute order on exchange using new SDK
			await client.createOrder({
				marketIndex: market.marketId,
				clientOrderIndex: market.clientOrderIndex,
				baseAmount: Math.round(orderQuantity * market.qtyDecimals),
				price: Math.round(
					(directionIsLong ? latestPriceNum * 1.01 : latestPriceNum * 0.99) *
						market.priceDecimals,
				),
				isAsk: !directionIsLong,
				orderType: SignerClient.ORDER_TYPE_MARKET,
				timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
				reduceOnly: false,
				triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
				orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
			});
			// Check for existing open order to scale into
			try {
				const existingOrder = await getOpenOrderBySymbol(
					account.id,
					symbol.toUpperCase(),
				);

				if (existingOrder && existingOrder.side === side) {
					// Scale into existing position using weighted avg formula
					const prevQty = parseFloat(existingOrder.quantity);
					const prevEntry = parseFloat(existingOrder.entryPrice);
					const newQty = orderQuantity;
					const prevNotional = prevEntry * prevQty;
					const newNotional = latestPrice * newQty;
					const totalQty = prevQty + newQty;
					const newAvgEntry =
						totalQty !== 0
							? (prevNotional + newNotional) / totalQty
							: latestPrice;

				// When scaling in, new exit plan values REPLACE old ones
				const updatedOrder = await scaleIntoOrder({
						orderId: existingOrder.id,
						additionalQuantity: newQty.toString(),
						newEntryPrice: latestPrice.toString(),
						newAvgEntryPrice: newAvgEntry.toString(),
						exitPlan: {
							stop: stopLoss ?? existingOrder.exitPlan?.stop ?? null,
							target: profitTarget ?? existingOrder.exitPlan?.target ?? null,
							invalidation: invalidationCondition ?? existingOrder.exitPlan?.invalidation ?? null,
							invalidationPrice: existingOrder.exitPlan?.invalidationPrice ?? null,
							confidence: confidence ?? existingOrder.exitPlan?.confidence ?? null,
							timeExit: existingOrder.exitPlan?.timeExit ?? null,
							cooldownUntil: existingOrder.exitPlan?.cooldownUntil ?? null,
						},
					});

					// Update SL/TP orders on exchange (cancel old ones, place new ones)
					const newStop = stopLoss ?? existingOrder.exitPlan?.stop ?? null;
					const newTarget = profitTarget ?? existingOrder.exitPlan?.target ?? null;
					if (newStop || newTarget) {
						// Cancel existing SL/TP orders first
						if (existingOrder.slOrderIndex || existingOrder.tpOrderIndex) {
							await cancelSlTpOrders(
								client,
								symbol.toUpperCase(),
								existingOrder.slOrderIndex,
								existingOrder.tpOrderIndex,
								existingOrder.id,
							);
						}
						// Place new SL/TP orders with updated quantity
						await placeSlTpOrders(client, {
							symbol: symbol.toUpperCase(),
							side,
							quantity: totalQty,
							stopLoss: newStop,
							takeProfit: newTarget,
							orderId: updatedOrder.id,
						});
					}

					results.push({
						symbol,
						side,
						quantity: totalQty,
						leverage,
						entryPrice: newAvgEntry,
						success: true,
						orderId: updatedOrder.id,
					});
				} else {
				// Create new order (either no existing position or opposite side)
					// TODO: In live trading, we should fetch the actual fill quantity from the exchange
					// For now, we assume the market order fills completely at the requested quantity
					const dbOrder = await createOrder({
						modelId: account.id,
						symbol: symbol.toUpperCase(),
						side,
						quantity: orderQuantity.toString(),
						entryPrice: latestPrice.toString(),
						leverage: leverage?.toString() ?? null,
						exitPlan: {
							stop: stopLoss ?? null,
							target: profitTarget ?? null,
							invalidation: invalidationCondition ?? null,
							invalidationPrice: null,
							confidence: confidence ?? null,
							timeExit: null,
							cooldownUntil: null,
						},
					});

					// Place SL/TP orders on exchange
					if (stopLoss || profitTarget) {
						await placeSlTpOrders(client, {
							symbol: symbol.toUpperCase(),
							side,
							quantity: orderQuantity,
							stopLoss: stopLoss ?? null,
							takeProfit: profitTarget ?? null,
							orderId: dbOrder.id,
						});
					}

					results.push({
						symbol,
						side,
						quantity,
						leverage,
						entryPrice: latestPrice,
						success: true,
						orderId: dbOrder.id,
					});
				}
			} catch (dbError) {
				console.error(
					`[createPosition] DB persist failed for ${symbol}:`,
					dbError,
				);
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					entryPrice: latestPrice,
					success: true,
				});
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			console.error(`Failed to create position for ${symbol}:`, err);
			results.push({
				symbol,
				side,
				quantity,
				leverage,
				success: false,
				error: errorMsg,
			});
		}
	}

	return results;
}
