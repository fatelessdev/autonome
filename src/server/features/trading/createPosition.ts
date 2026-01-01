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
import { candlestickApi } from "@/server/integrations/lighter";
import {
	createOrder,
	getOpenOrderBySymbol,
	scaleIntoOrder,
} from "@/server/db/ordersRepository.server";

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
							const newQty = orderQuantity;
							const prevNotional = prevEntry * prevQty;
							const newNotional = entryPrice * newQty;
							const totalQty = prevQty + newQty;
							const newAvgEntry =
								totalQty !== 0
									? (prevNotional + newNotional) / totalQty
									: entryPrice;

							const updatedOrder = await scaleIntoOrder({
								orderId: existingOrder.id,
								additionalQuantity: newQty.toString(),
								newEntryPrice: entryPrice.toString(),
								newAvgEntryPrice: newAvgEntry.toString(),
								exitPlan: {
									stop: stopLoss ?? existingOrder.exitPlan?.stop ?? null,
									target:
										profitTarget ?? existingOrder.exitPlan?.target ?? null,
									invalidation:
										invalidationCondition ??
										existingOrder.exitPlan?.invalidation ??
										null,
									confidence:
										confidence ?? existingOrder.exitPlan?.confidence ?? null,
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
								quantity: orderQuantity.toString(),
								entryPrice: entryPrice.toString(),
								leverage: leverage?.toString() ?? null,
								exitPlan: {
									stop: stopLoss ?? null,
									target: profitTarget ?? null,
									invalidation: invalidationCondition ?? null,
									confidence: confidence ?? null,
								},
							});

							results.push({
								symbol,
								side,
								quantity,
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
							quantity,
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

			// Fetch latest price using new SDK API
			const candleStickData = await candlestickApi.getCandlesticks({
				market_id: market.marketId,
				resolution: "1m",
				start_timestamp: Date.now() - 1000 * 60 * 5,
				end_timestamp: Date.now(),
				count_back: 1,
			});
			const latestPrice =
				candleStickData?.candlesticks?.[candleStickData.candlesticks.length - 1]
					?.close;
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

			const latestPriceNum = parseFloat(latestPrice);
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
					const newNotional = latestPriceNum * newQty;
					const totalQty = prevQty + newQty;
					const newAvgEntry =
						totalQty !== 0
							? (prevNotional + newNotional) / totalQty
							: latestPriceNum;

					const updatedOrder = await scaleIntoOrder({
						orderId: existingOrder.id,
						additionalQuantity: newQty.toString(),
						newEntryPrice: latestPriceNum.toString(),
						newAvgEntryPrice: newAvgEntry.toString(),
						exitPlan: {
							stop: stopLoss ?? existingOrder.exitPlan?.stop ?? null,
							target: profitTarget ?? existingOrder.exitPlan?.target ?? null,
							invalidation:
								invalidationCondition ??
								existingOrder.exitPlan?.invalidation ??
								null,
							confidence:
								confidence ?? existingOrder.exitPlan?.confidence ?? null,
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
						modelId: account.id,
						symbol: symbol.toUpperCase(),
						side,
						quantity: orderQuantity.toString(),
						entryPrice: latestPriceNum.toString(),
						leverage: leverage?.toString() ?? null,
						exitPlan: {
							stop: stopLoss ?? null,
							target: profitTarget ?? null,
							invalidation: invalidationCondition ?? null,
							confidence: confidence ?? null,
						},
					});

					results.push({
						symbol,
						side,
						quantity,
						leverage,
						entryPrice: latestPriceNum,
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
					entryPrice: latestPriceNum,
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

	// Close the client when done
	await client.close();

	return results;
}
