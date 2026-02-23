import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
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
import type { Order } from "@/db/schema";
import { placeSlTpOrders, cancelSlTpOrders } from "./slTpOrderManager";
import { trackFill } from "./fillTracker";

// ==========================================
// Types
// ==========================================

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

interface ExitPlan {
	stop: number | null;
	target: number | null;
	invalidation: string | null;
	invalidationPrice: number | null;
	confidence: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
}

// ==========================================
// Helper Functions (extracted to eliminate duplication)
// ==========================================

/**
 * Calculate weighted average entry price when scaling into a position.
 * Formula: (prevNotional + newNotional) / totalQuantity
 */
function calculateWeightedAvgEntry(
	prevQuantity: number,
	prevEntryPrice: number,
	newQuantity: number,
	newEntryPrice: number,
): number {
	const prevNotional = prevEntryPrice * prevQuantity;
	const newNotional = newEntryPrice * newQuantity;
	const totalQty = prevQuantity + newQuantity;
	return totalQty !== 0 ? (prevNotional + newNotional) / totalQty : newEntryPrice;
}

/**
 * Build exit plan for a position, merging new values with existing plan.
 * New values take precedence when provided.
 */
function buildExitPlan(
	stopLoss: number | null,
	profitTarget: number | null,
	invalidationCondition: string | null,
	confidence: number | null,
	existingPlan?: ExitPlan | null,
): ExitPlan {
	return {
		stop: stopLoss ?? existingPlan?.stop ?? null,
		target: profitTarget ?? existingPlan?.target ?? null,
		invalidation: invalidationCondition ?? existingPlan?.invalidation ?? null,
		invalidationPrice: existingPlan?.invalidationPrice ?? null,
		confidence: confidence ?? existingPlan?.confidence ?? null,
		timeExit: existingPlan?.timeExit ?? null,
		cooldownUntil: existingPlan?.cooldownUntil ?? null,
	};
}

/**
 * Persist a new order to the database
 */
async function persistNewOrder(params: {
	modelId: string;
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number;
	entryPrice: number;
	leverage: number | null;
	exitPlan: ExitPlan;
}): Promise<Order> {
	return createOrder({
		modelId: params.modelId,
		symbol: params.symbol.toUpperCase(),
		side: params.side,
		quantity: params.quantity.toString(),
		entryPrice: params.entryPrice.toString(),
		leverage: params.leverage?.toString() ?? null,
		exitPlan: params.exitPlan,
	});
}

/**
 * Scale into an existing order with new quantity and price
 */
async function scaleIntoExistingOrder(params: {
	existingOrder: Order;
	newQuantity: number;
	newEntryPrice: number;
	exitPlan: ExitPlan;
}): Promise<{ order: Order; totalQuantity: number; avgEntryPrice: number }> {
	const prevQty = parseFloat(params.existingOrder.quantity);
	const prevEntry = parseFloat(params.existingOrder.entryPrice);
	const totalQty = prevQty + params.newQuantity;
	const avgEntry = calculateWeightedAvgEntry(
		prevQty,
		prevEntry,
		params.newQuantity,
		params.newEntryPrice,
	);

	const updatedOrder = await scaleIntoOrder({
		orderId: params.existingOrder.id,
		additionalQuantity: params.newQuantity.toString(),
		newEntryPrice: params.newEntryPrice.toString(),
		newAvgEntryPrice: avgEntry.toString(),
		exitPlan: params.exitPlan,
	});

	return {
		order: updatedOrder,
		totalQuantity: totalQty,
		avgEntryPrice: avgEntry,
	};
}

// ==========================================
// Main Function
// ==========================================

export async function createPosition(
	account: Account,
	positions: PositionRequest[],
): Promise<PositionResult[]> {
	if (!positions || positions.length === 0) {
		return [];
	}

	if (IS_SIMULATION_ENABLED) {
		return createSimulatedPositions(account, positions);
	}

	return createLivePositions(account, positions);
}

// ==========================================
// Simulator Implementation
// ==========================================

async function createSimulatedPositions(
	account: Account,
	positions: PositionRequest[],
): Promise<PositionResult[]> {
	const simulator = await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
	const accountId = account.id || "default";
	const results: PositionResult[] = [];

	for (const request of positions) {
		const { symbol, side, quantity, leverage, confidence, profitTarget, stopLoss, invalidationCondition } = request;

		if (side === "HOLD") {
			results.push({ symbol, side, quantity, leverage, success: true });
			continue;
		}

		try {
			const orderSide: OrderSide = side === "LONG" ? "buy" : "sell";
			const orderQuantity = Math.abs(quantity);

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
				continue;
			}

			const entryPrice = execution.averagePrice ?? 0;
			const filledQuantity = execution.totalQuantity;

			// Persist to database
			const dbResult = await persistPositionToDb({
				modelId: accountId,
				symbol,
				side,
				filledQuantity,
				entryPrice,
				leverage,
				stopLoss,
				profitTarget,
				invalidationCondition,
				confidence,
			});

			results.push({
				symbol,
				side,
				quantity: dbResult.quantity,
				leverage,
				entryPrice: dbResult.entryPrice,
				success: true,
				orderId: dbResult.orderId,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
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

// ==========================================
// Live Trading Implementation
// ==========================================

async function createLivePositions(
	account: Account,
	positions: PositionRequest[],
): Promise<PositionResult[]> {
	const client = await SignerClientFactory.create({
		url: BASE_URL,
		privateKey: account.apiKey,
		apiKeyIndex: API_KEY_INDEX,
		accountIndex: Number(account.accountIndex),
	});

	const results: PositionResult[] = [];

	for (const request of positions) {
		const { symbol, side, quantity, leverage, profitTarget, stopLoss, invalidationCondition, confidence } = request;

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

			// Fetch latest price
			const latestPriceNum = await fetchLatestPrice(market.marketId);
			if (latestPriceNum === null) {
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

			// Execute order on exchange
			const fillResult = await executeOrderOnExchange(client, {
				market,
				side,
				quantity: Math.abs(quantity),
				latestPrice: latestPriceNum,
				accountIndex: Number(account.accountIndex),
			});

			if (!fillResult.success) {
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: fillResult.error ?? "Order execution failed",
				});
				continue;
			}

			const { filledQuantity, actualEntryPrice } = fillResult;

			// Persist to database
			const dbResult = await persistPositionToDb({
				modelId: account.id,
				symbol,
				side,
				filledQuantity,
				entryPrice: actualEntryPrice,
				leverage,
				stopLoss,
				profitTarget,
				invalidationCondition,
				confidence,
			});

			// Place SL/TP orders on exchange for new positions or updated scale-ins
			if (dbResult.isScaleIn && dbResult.existingOrder) {
				// Cancel existing SL/TP and place new ones with updated quantity
				const newStop = stopLoss ?? dbResult.existingOrder.exitPlan?.stop ?? null;
				const newTarget = profitTarget ?? dbResult.existingOrder.exitPlan?.target ?? null;
				if (newStop || newTarget) {
					if (dbResult.existingOrder.slOrderIndex || dbResult.existingOrder.tpOrderIndex) {
						await cancelSlTpOrders(
							client,
							symbol.toUpperCase(),
							dbResult.existingOrder.slOrderIndex,
							dbResult.existingOrder.tpOrderIndex,
							dbResult.existingOrder.id,
						);
					}
					await placeSlTpOrders(client, {
						symbol: symbol.toUpperCase(),
						side,
						quantity: dbResult.quantity,
						stopLoss: newStop,
						takeProfit: newTarget,
						orderId: dbResult.orderId,
					});
				}
			} else if (stopLoss || profitTarget) {
				// New position - place SL/TP orders
				await placeSlTpOrders(client, {
					symbol: symbol.toUpperCase(),
					side,
					quantity: filledQuantity,
					stopLoss: stopLoss ?? null,
					takeProfit: profitTarget ?? null,
					orderId: dbResult.orderId,
				});
			}

			results.push({
				symbol,
				side,
				quantity: dbResult.quantity,
				leverage,
				entryPrice: dbResult.entryPrice,
				success: true,
				orderId: dbResult.orderId,
			});
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

// ==========================================
// Shared Helpers
// ==========================================

async function fetchLatestPrice(marketId: number): Promise<number | null> {
	const candles = await fetchCandlesticksRest({
		market_id: marketId,
		resolution: "1m",
		start_timestamp: Date.now() - 1000 * 60 * 5,
		end_timestamp: Date.now(),
		count_back: 1,
	});
	const latestPrice = candles?.[candles.length - 1]?.close;
	if (!latestPrice) return null;
	return typeof latestPrice === "number" ? latestPrice : parseFloat(String(latestPrice));
}

interface ExecuteOrderResult {
	success: boolean;
	filledQuantity: number;
	actualEntryPrice: number;
	error?: string;
}

async function executeOrderOnExchange(
	client: Awaited<ReturnType<typeof SignerClientFactory.create>>,
	params: {
		market: (typeof MARKETS)[keyof typeof MARKETS];
		side: "LONG" | "SHORT";
		quantity: number;
		latestPrice: number;
		accountIndex: number;
	},
): Promise<ExecuteOrderResult> {
	const { market, side, quantity, latestPrice, accountIndex } = params;
	const directionIsLong = side === "LONG";

	const [, txHash, orderError] = await client.createOrder({
		marketIndex: market.marketId,
		clientOrderIndex: market.clientOrderIndex,
		baseAmount: Math.round(quantity * market.qtyDecimals),
		price: Math.round(
			(directionIsLong ? latestPrice * 1.01 : latestPrice * 0.99) * market.priceDecimals,
		),
		isAsk: !directionIsLong,
		orderType: SignerClient.ORDER_TYPE_MARKET,
		timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
		reduceOnly: false,
		triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
		orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
	});

	if (orderError) {
		console.error(`[createPosition] Order creation failed:`, orderError);
		return {
			success: false,
			filledQuantity: 0,
			actualEntryPrice: 0,
			error: `Order creation failed: ${orderError}`,
		};
	}

	// Track fill with polling
	const fillResult = await trackFill(client, {
		txHash,
		accountIndex,
		marketId: market.marketId,
		clientOrderIndex: market.clientOrderIndex,
		requestedQuantity: quantity,
		maxWaitMs: 30_000,
		pollIntervalMs: 500,
	});

	if (!fillResult.success || !fillResult.filled) {
		console.error(`[createPosition] Order not filled:`, fillResult.error);
		return {
			success: false,
			filledQuantity: 0,
			actualEntryPrice: 0,
			error: fillResult.error ?? "Order not filled",
		};
	}

	const filledQuantity = fillResult.filledQuantity;
	const actualEntryPrice = fillResult.averagePrice > 0 ? fillResult.averagePrice : latestPrice;

	if (fillResult.partialFill) {
		console.warn(
			`[createPosition] Partial fill: requested=${quantity}, filled=${filledQuantity}`,
		);
	}

	console.log(`[createPosition] Fill confirmed: qty=${filledQuantity}, price=${actualEntryPrice}`);

	return {
		success: true,
		filledQuantity,
		actualEntryPrice,
	};
}

interface PersistResult {
	orderId: string;
	quantity: number;
	entryPrice: number;
	isScaleIn: boolean;
	existingOrder?: Order | null;
}

async function persistPositionToDb(params: {
	modelId: string;
	symbol: string;
	side: "LONG" | "SHORT";
	filledQuantity: number;
	entryPrice: number;
	leverage: number | null;
	stopLoss: number | null;
	profitTarget: number | null;
	invalidationCondition: string | null;
	confidence: number | null;
}): Promise<PersistResult> {
	const {
		modelId,
		symbol,
		side,
		filledQuantity,
		entryPrice,
		leverage,
		stopLoss,
		profitTarget,
		invalidationCondition,
		confidence,
	} = params;

	try {
		const existingOrder = await getOpenOrderBySymbol(modelId, symbol.toUpperCase());

		if (existingOrder && existingOrder.side === side) {
			// Scale into existing position
			const exitPlan = buildExitPlan(
				stopLoss,
				profitTarget,
				invalidationCondition,
				confidence,
				existingOrder.exitPlan as ExitPlan | null,
			);

			const scaleResult = await scaleIntoExistingOrder({
				existingOrder,
				newQuantity: filledQuantity,
				newEntryPrice: entryPrice,
				exitPlan,
			});

			return {
				orderId: scaleResult.order.id,
				quantity: scaleResult.totalQuantity,
				entryPrice: scaleResult.avgEntryPrice,
				isScaleIn: true,
				existingOrder,
			};
		}

		// Create new order
		const exitPlan = buildExitPlan(stopLoss, profitTarget, invalidationCondition, confidence);
		const dbOrder = await persistNewOrder({
			modelId,
			symbol,
			side,
			quantity: filledQuantity,
			entryPrice,
			leverage,
			exitPlan,
		});

		return {
			orderId: dbOrder.id,
			quantity: filledQuantity,
			entryPrice,
			isScaleIn: false,
			existingOrder: null,
		};
	} catch (dbError) {
		console.error(`[createPosition] DB persist failed for ${symbol}:`, dbError);
		// Return a partial result - position exists but DB save failed
		return {
			orderId: "",
			quantity: filledQuantity,
			entryPrice,
			isScaleIn: false,
			existingOrder: null,
		};
	}
}
