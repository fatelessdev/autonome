/**
 * Create Position (Alpaca)
 *
 * Handles opening new positions and scaling into existing ones via Alpaca's Trading API.
 * Uses bracket orders for automatic SL/TP placement.
 * Single Alpaca code path.
 */

import {
	toAlpacaSymbol,
	toCanonical,
} from "@/core/shared/markets/marketMetadata";
import type { Order } from "@/db/schema";
import {
	createOrder,
	getOpenOrderBySymbol,
	scaleIntoOrder,
	updateAlpacaOrderId,
} from "@/server/db/ordersRepository.server";
import { MINIMUM_TRADE_SIZE_USD } from "@/server/features/trading/agent/tools/types";
import type { Account } from "@/server/features/trading/contracts/accounts";
import {
	getMarketDataProvider,
	getTradingProvider,
} from "@/server/providers/alpaca";

// ==========================================
// Constants
// ==========================================

/**
 * Exponential backoff delays (ms) for fill polling.
 * 4 attempts: 500ms, 1s, 2s, 4s — total max wait ~7.5s.
 */
const FILL_POLL_BACKOFF_DELAYS_MS = [500, 1_000, 2_000, 4_000];

// ==========================================
// Types
// ==========================================

// TODO: Collapse the 7 flat exit-plan fields (profitTarget, stopLoss, invalidationCondition,
// invalidationPrice, timeExit, cooldownUntil, confidence) into an embedded `exitPlan: ExitPlan`.
// Blocked on: field-name mismatch (stopLoss→stop, profitTarget→target, invalidationCondition→invalidation),
// NormalizedDecision in agent/schemas.ts mirrors the flat shape (Zod tool schema), and
// createPositionTool.ts passes NormalizedDecision[] directly as PositionRequest[].
// Requires coordinated rename of ExitPlan fields or a mapping layer in the tool.
export interface PositionRequest {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	invalidationPrice: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
	confidence: number | null;
	/** Optional: link to the tool call that created this position */
	toolCallId?: string;
}

export interface PositionResult {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	entryPrice?: number;
	success: boolean;
	error?: string;
	/** The database order ID for this position */
	orderId?: string;
	/** Note about size adjustment (e.g., capped to available balance) */
	adjustmentNote?: string;
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
// Helper Functions
// ==========================================

/**
 * Calculate weighted average entry price when scaling into a position.
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
	return totalQty !== 0
		? (prevNotional + newNotional) / totalQty
		: newEntryPrice;
}

/**
 * Build exit plan for a position, merging new values with existing plan.
 */
function buildExitPlan(
	opts: {
		stopLoss: number | null;
		profitTarget: number | null;
		invalidationCondition: string | null;
		invalidationPrice: number | null;
		confidence: number | null;
		timeExit: string | null;
		cooldownUntil: string | null;
	},
	existingPlan?: ExitPlan | null,
): ExitPlan {
	return {
		stop: opts.stopLoss ?? existingPlan?.stop ?? null,
		target: opts.profitTarget ?? existingPlan?.target ?? null,
		invalidation:
			opts.invalidationCondition ?? existingPlan?.invalidation ?? null,
		invalidationPrice:
			opts.invalidationPrice ?? existingPlan?.invalidationPrice ?? null,
		confidence: opts.confidence ?? existingPlan?.confidence ?? null,
		timeExit: opts.timeExit ?? existingPlan?.timeExit ?? null,
		cooldownUntil: opts.cooldownUntil ?? existingPlan?.cooldownUntil ?? null,
	};
}

/**
 * Persist a new order to the database
 */
function persistNewOrder(params: {
	modelId: string;
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number;
	entryPrice: number;
	exitPlan: ExitPlan;
}): Promise<Order> {
	const canonicalSymbol = toCanonical(params.symbol).toUpperCase();

	return createOrder({
		modelId: params.modelId,
		symbol: canonicalSymbol,
		side: params.side,
		quantity: params.quantity.toString(),
		entryPrice: params.entryPrice.toString(),
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
	const prevQty = Number.parseFloat(params.existingOrder.quantity);
	const prevEntry = Number.parseFloat(params.existingOrder.entryPrice);
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

	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);
	const results: PositionResult[] = [];

	for (const request of positions) {
		const {
			symbol,
			side,
			quantity,
			profitTarget,
			stopLoss,
			invalidationCondition,
			invalidationPrice,
			timeExit,
			cooldownUntil,
			confidence,
		} = request;

		if (side === "HOLD") {
			console.warn(
				`[createPosition] Skipping ${symbol}: HOLD requested — no order placed`,
			);
			results.push({ symbol, side, quantity, success: true });
			continue;
		}

		try {
			if (!Number.isFinite(quantity) || quantity <= 0) {
				throw new Error(
					`Invalid quantity for ${symbol}: expected positive finite number, received ${quantity}`,
				);
			}

			const alpacaSymbol = toAlpacaSymbol(symbol);
			const orderQty = Math.abs(quantity);
			const orderSide = side === "LONG" ? "buy" : "sell";

			// Minimum trade size guard — fetch a quote to estimate notional
			const marketData = getMarketDataProvider(
				account.alpacaApiKey,
				account.alpacaApiSecret,
			);
			const quote = await marketData.getQuote(alpacaSymbol);
			const estimatedPrice =
				quote.bid_price && quote.ask_price
					? (quote.bid_price + quote.ask_price) / 2
					: quote.bid_price || quote.ask_price;
			if (estimatedPrice) {
				const notional = orderQty * estimatedPrice;
				if (notional < MINIMUM_TRADE_SIZE_USD) {
					throw new Error(
						`Trade rejected for ${symbol}: notional $${notional.toFixed(2)} is below the minimum $${MINIMUM_TRADE_SIZE_USD}. Increase quantity or skip this trade.`,
					);
				}
			}

			// Auto-adjust: cap trade size to available balance if oversized
			let adjustedQty = orderQty;
			let adjustmentNote: string | undefined;
			if (estimatedPrice && estimatedPrice > 0) {
				const accountInfo = await trading.getAccount();
				const availableCash = accountInfo.cash;
				const requestedNotional = orderQty * estimatedPrice;
				if (requestedNotional > availableCash) {
					const maxQty =
						Math.floor((availableCash / estimatedPrice) * 1000000) / 1000000;
					if (maxQty <= 0) {
						throw new Error(
							`Insufficient balance for ${symbol}: available $${availableCash.toFixed(2)} cannot cover any quantity at ~$${estimatedPrice.toFixed(2)}`,
						);
					}
					adjustedQty = maxQty;
					adjustmentNote = `Trade size adjusted: requested ${orderQty} ($${requestedNotional.toFixed(2)}) exceeds available balance ($${availableCash.toFixed(2)}). Capped to ${maxQty} ($${(maxQty * estimatedPrice).toFixed(2)}).`;
					console.warn(`[createPosition] ${adjustmentNote}`);
				}
			}
			const finalQty = adjustedQty;

			// Build Alpaca order params
			const orderParams: Parameters<typeof trading.createOrder>[0] = {
				symbol: alpacaSymbol,
				qty: finalQty,
				side: orderSide as "buy" | "sell",
				type: "market",
				time_in_force: "gtc",
			};

			// Alpaca doesn't support bracket/oto/oco for crypto.
			// For crypto: submit simple market order, then place independent SL/TP orders after fill.
			// For equities: use bracket orders for automatic SL/TP.
			const isCrypto = alpacaSymbol.includes("/");

			if (!isCrypto) {
				if (stopLoss && profitTarget) {
					orderParams.order_class = "bracket";
					orderParams.take_profit = { limit_price: profitTarget };
					orderParams.stop_loss = { stop_price: stopLoss };
				} else if (stopLoss) {
					orderParams.order_class = "oto";
					orderParams.stop_loss = { stop_price: stopLoss };
				} else if (profitTarget) {
					orderParams.order_class = "oto";
					orderParams.take_profit = { limit_price: profitTarget };
				}
			}

			// Execute entry order via Alpaca
			const alpacaOrder = await trading.createOrder(orderParams);

			// Extract fill price — market orders fill near-instantly on Alpaca paper trading,
			// but the response may arrive before settlement. Poll briefly if not yet filled.
			let filledPrice = alpacaOrder.filled_avg_price
				? Number.parseFloat(alpacaOrder.filled_avg_price)
				: 0;
			let filledQty = alpacaOrder.filled_qty
				? Number.parseFloat(alpacaOrder.filled_qty)
				: 0;

			if (!alpacaOrder.filled_avg_price) {
				for (
					let attempt = 0;
					attempt < FILL_POLL_BACKOFF_DELAYS_MS.length;
					attempt++
				) {
					await new Promise((r) =>
						setTimeout(r, FILL_POLL_BACKOFF_DELAYS_MS[attempt]),
					);
					const refreshed = await trading.getOrder(alpacaOrder.id);
					if (refreshed.filled_avg_price) {
						filledPrice = Number.parseFloat(refreshed.filled_avg_price);
						filledQty = refreshed.filled_qty
							? Number.parseFloat(refreshed.filled_qty)
							: finalQty;
						break;
					}
				}
			}

			if (!filledPrice) {
				console.error(
					`[createPosition] PERSISTENT FAILURE: Order ${alpacaOrder.id} for ${symbol} was not filled after ${FILL_POLL_BACKOFF_DELAYS_MS.length} attempts with exponential backoff. This may indicate a broker issue or halted market.`,
				);
				throw new Error(
					`Order ${alpacaOrder.id} for ${symbol} was not filled after ${FILL_POLL_BACKOFF_DELAYS_MS.length} polls with exponential backoff`,
				);
			}

			// If Alpaca omits filled_qty but we have a confirmed fill price, fallback to the submitted qty.
			const effectiveQty =
				Number.isFinite(filledQty) && filledQty > 0 ? filledQty : finalQty;
			if (!Number.isFinite(effectiveQty) || effectiveQty <= 0) {
				throw new Error(
					`Invalid effective quantity for ${symbol}: ${effectiveQty}`,
				);
			}

			// For crypto: place independent SL/TP orders after the entry fills.
			// These are standalone orders (not bracket) since Alpaca doesn't support
			// advanced order classes for crypto.
			// IMPORTANT: Alpaca crypto only supports: market, limit, stop_limit.
			// Plain "stop" orders are NOT supported for crypto — must use stop_limit
			// with a limit_price that includes slippage buffer.
			if (isCrypto && filledPrice > 0) {
				const exitSide = orderSide === "buy" ? "sell" : "buy";
				if (stopLoss) {
					// Use stop_limit for crypto SL (Alpaca doesn't support plain stop for crypto).
					// Apply 0.5% slippage buffer: for sells (long SL), limit below stop;
					// for buys (short SL), limit above stop.
					const slippageMultiplier = exitSide === "sell" ? 0.995 : 1.005;
					const slLimitPrice =
						Math.round(stopLoss * slippageMultiplier * 100) / 100;
					await trading.createOrder({
						symbol: alpacaSymbol,
						qty: effectiveQty,
						side: exitSide as "buy" | "sell",
						type: "stop_limit",
						stop_price: stopLoss,
						limit_price: slLimitPrice,
						time_in_force: "gtc",
					});
				}
				if (profitTarget) {
					await trading.createOrder({
						symbol: alpacaSymbol,
						qty: effectiveQty,
						side: exitSide as "buy" | "sell",
						type: "limit",
						limit_price: profitTarget,
						time_in_force: "gtc",
					});
				}
			}

			// Persist to database
			const dbResult = await persistPositionToDb({
				modelId: account.id,
				symbol,
				side,
				filledQuantity: effectiveQty,
				entryPrice: filledPrice,
				stopLoss,
				profitTarget,
				invalidationCondition,
				invalidationPrice,
				timeExit,
				cooldownUntil,
				confidence,
				alpacaOrderId: alpacaOrder.id,
			});

			results.push({
				symbol,
				side,
				quantity: dbResult.quantity,
				entryPrice: dbResult.entryPrice,
				success: true,
				orderId: dbResult.orderId,
				adjustmentNote,
			});
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			console.error(`[createPosition] Failed for ${symbol}:`, errorMsg);
			results.push({
				symbol,
				side,
				quantity,
				success: false,
				error: errorMsg,
			});
		}
	}

	return results;
}

// ==========================================
// DB Persistence
// ==========================================

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
	stopLoss: number | null;
	profitTarget: number | null;
	invalidationCondition: string | null;
	invalidationPrice: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
	confidence: number | null;
	alpacaOrderId: string;
}): Promise<PersistResult> {
	const {
		modelId,
		symbol,
		side,
		filledQuantity,
		entryPrice,
		stopLoss,
		profitTarget,
		invalidationCondition,
		invalidationPrice,
		timeExit,
		cooldownUntil,
		confidence,
		alpacaOrderId,
	} = params;

	const canonicalSymbol = toCanonical(symbol).toUpperCase();

	const existingOrder = await getOpenOrderBySymbol(modelId, canonicalSymbol);

	if (existingOrder && existingOrder.side === side) {
		const exitPlan = buildExitPlan(
			{
				stopLoss,
				profitTarget,
				invalidationCondition,
				invalidationPrice,
				confidence,
				timeExit,
				cooldownUntil,
			},
			existingOrder.exitPlan as ExitPlan | null,
		);

		const scaleResult = await scaleIntoExistingOrder({
			existingOrder,
			newQuantity: filledQuantity,
			newEntryPrice: entryPrice,
			exitPlan,
		});

		await updateAlpacaOrderId({
			orderId: scaleResult.order.id,
			alpacaOrderId,
		});

		return {
			orderId: scaleResult.order.id,
			quantity: scaleResult.totalQuantity,
			entryPrice: scaleResult.avgEntryPrice,
			isScaleIn: true,
			existingOrder,
		};
	}

	const exitPlan = buildExitPlan({
		stopLoss,
		profitTarget,
		invalidationCondition,
		invalidationPrice,
		confidence,
		timeExit,
		cooldownUntil,
	});
	const dbOrder = await persistNewOrder({
		modelId,
		symbol: canonicalSymbol,
		side,
		quantity: filledQuantity,
		entryPrice,
		exitPlan,
	});

	await updateAlpacaOrderId({
		orderId: dbOrder.id,
		alpacaOrderId,
	});

	return {
		orderId: dbOrder.id,
		quantity: filledQuantity,
		entryPrice,
		isScaleIn: false,
		existingOrder: null,
	};
}
