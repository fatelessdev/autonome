/**
 * SL/TP Order Manager
 * 
 * Handles placing and canceling real stop-loss and take-profit orders
 * on the Lighter exchange.
 */

import { MARKETS } from "@/shared/markets/marketMetadata";
import { SignerClient } from "./signerClient";
import { updateSlTpOrders, clearSlTpOrders } from "@/server/db/ordersRepository.server";

// SignerClient type for the client parameter (handles conditional import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignerClientInstance = any;

export interface SlTpOrderParams {
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number;
	stopLoss: number | null;
	takeProfit: number | null;
	orderId: string; // DB order ID to update
}

export interface SlTpOrderResult {
	success: boolean;
	slOrderIndex?: string;
	tpOrderIndex?: string;
	error?: string;
}

/**
 * Place SL/TP orders on the exchange after opening a position
 */
export async function placeSlTpOrders(
	client: SignerClientInstance,
	params: SlTpOrderParams,
): Promise<SlTpOrderResult> {
	const market = MARKETS[params.symbol as keyof typeof MARKETS];
	if (!market) {
		return { success: false, error: `Market ${params.symbol} not found` };
	}

	const isLong = params.side === "LONG";
	// For closing positions: LONG -> sell (isAsk=true), SHORT -> buy (isAsk=false)
	const closeIsAsk = isLong;
	
	const baseAmount = Math.round(Math.abs(params.quantity) * market.qtyDecimals);
	
	let slOrderIndex: string | undefined;
	let tpOrderIndex: string | undefined;
	
	try {
		// Place stop-loss order if provided
		if (params.stopLoss != null && params.stopLoss > 0) {
			const slPrice = Math.round(params.stopLoss * market.priceDecimals);
			const slTriggerPrice = Math.round(params.stopLoss * market.priceDecimals);
			
			console.log(`[SlTpManager] Placing SL order for ${params.symbol}: trigger=${params.stopLoss}, isAsk=${closeIsAsk}`);
			
			await client.createOrder({
				marketIndex: market.marketId,
				clientOrderIndex: market.slClientOrderIndex,
				baseAmount,
				price: slPrice,
				isAsk: closeIsAsk,
				orderType: SignerClient.ORDER_TYPE_STOP_LOSS,
				timeInForce: SignerClient.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME,
				reduceOnly: 1, // SL/TP should always be reduce-only
				triggerPrice: slTriggerPrice,
				orderExpiry: SignerClient.DEFAULT_28_DAY_ORDER_EXPIRY,
			});
			
			// Store the clientOrderIndex as the "order index" for cancellation
			slOrderIndex = market.slClientOrderIndex.toString();
			console.log(`[SlTpManager] SL order placed: clientOrderIndex=${slOrderIndex}`);
		}

		// Place take-profit order if provided
		if (params.takeProfit != null && params.takeProfit > 0) {
			const tpPrice = Math.round(params.takeProfit * market.priceDecimals);
			const tpTriggerPrice = Math.round(params.takeProfit * market.priceDecimals);
			
			console.log(`[SlTpManager] Placing TP order for ${params.symbol}: trigger=${params.takeProfit}, isAsk=${closeIsAsk}`);
			
			await client.createOrder({
				marketIndex: market.marketId,
				clientOrderIndex: market.tpClientOrderIndex,
				baseAmount,
				price: tpPrice,
				isAsk: closeIsAsk,
				orderType: SignerClient.ORDER_TYPE_TAKE_PROFIT,
				timeInForce: SignerClient.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME,
				reduceOnly: 1,
				triggerPrice: tpTriggerPrice,
				orderExpiry: SignerClient.DEFAULT_28_DAY_ORDER_EXPIRY,
			});
			
			tpOrderIndex = market.tpClientOrderIndex.toString();
			console.log(`[SlTpManager] TP order placed: clientOrderIndex=${tpOrderIndex}`);
		}

		// Update database with order indices
		if (slOrderIndex || tpOrderIndex) {
			await updateSlTpOrders({
				orderId: params.orderId,
				slOrderIndex: slOrderIndex ?? null,
				tpOrderIndex: tpOrderIndex ?? null,
				slTriggerPrice: params.stopLoss?.toString() ?? null,
				tpTriggerPrice: params.takeProfit?.toString() ?? null,
			});
		}

		return {
			success: true,
			slOrderIndex,
			tpOrderIndex,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[SlTpManager] Failed to place SL/TP orders:`, error);
		return {
			success: false,
			slOrderIndex,
			tpOrderIndex,
			error: errorMsg,
		};
	}
}

/**
 * Cancel existing SL/TP orders before closing a position or updating exit plan
 */
export async function cancelSlTpOrders(
	client: SignerClientInstance,
	symbol: string,
	slOrderIndex: string | null,
	tpOrderIndex: string | null,
	orderId: string,
): Promise<{ success: boolean; error?: string }> {
	const market = MARKETS[symbol as keyof typeof MARKETS];
	if (!market) {
		return { success: false, error: `Market ${symbol} not found` };
	}

	try {
		// Cancel stop-loss order
		if (slOrderIndex != null) {
			console.log(`[SlTpManager] Canceling SL order for ${symbol}: clientOrderIndex=${slOrderIndex}`);
			try {
				await client.cancelOrder({
					marketIndex: market.marketId,
					orderIndex: parseInt(slOrderIndex, 10),
				});
			} catch (err) {
				// Order might already be filled or cancelled - log but don't fail
				console.warn(`[SlTpManager] SL cancel failed (may be already gone):`, err);
			}
		}

		// Cancel take-profit order
		if (tpOrderIndex != null) {
			console.log(`[SlTpManager] Canceling TP order for ${symbol}: clientOrderIndex=${tpOrderIndex}`);
			try {
				await client.cancelOrder({
					marketIndex: market.marketId,
					orderIndex: parseInt(tpOrderIndex, 10),
				});
			} catch (err) {
				console.warn(`[SlTpManager] TP cancel failed (may be already gone):`, err);
			}
		}

		// Clear from database
		await clearSlTpOrders(orderId);

		return { success: true };
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[SlTpManager] Failed to cancel SL/TP orders:`, error);
		return { success: false, error: errorMsg };
	}
}

/**
 * Update SL/TP orders (cancel old ones and place new ones)
 */
export async function updateSlTpOrdersOnExchange(
	client: SignerClientInstance,
	symbol: string,
	side: "LONG" | "SHORT",
	quantity: number,
	orderId: string,
	oldSlOrderIndex: string | null,
	oldTpOrderIndex: string | null,
	newStopLoss: number | null,
	newTakeProfit: number | null,
): Promise<SlTpOrderResult> {
	// First cancel existing orders
	if (oldSlOrderIndex || oldTpOrderIndex) {
		await cancelSlTpOrders(client, symbol, oldSlOrderIndex, oldTpOrderIndex, orderId);
	}

	// Place new orders
	return placeSlTpOrders(client, {
		symbol,
		side,
		quantity,
		stopLoss: newStopLoss,
		takeProfit: newTakeProfit,
		orderId,
	});
}
