/**
 * Close Position (Alpaca)
 *
 * Closes open positions via Alpaca's position close endpoint.
 * Single Alpaca code path.
 * For equities: Alpaca automatically cancels attached bracket legs (SL/TP).
 * For crypto: we cancel independent SL/TP orders before closing the position.
 */

import type { Account } from "@/server/features/trading/contracts/accounts";
import { normalizeNumber } from "@/shared/formatting/numberFormat";
import {
	getOpenPositions,
	type OpenPositionSummary,
} from "@/server/features/trading/data/positions";
import { getTradingProvider } from "@/server/providers/alpaca";
import { toAlpacaSymbol, toCanonical } from "@/shared/markets/marketMetadata";
import {
	closeOrder,
	getOpenOrderBySymbol,
} from "@/server/db/ordersRepository.server";

export interface ClosedPositionSummary {
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	markPrice: number | null;
	entryNotional: number | null;
	exitNotional: number | null;
	netPnl: number | null;
	realizedPnl: number | null;
	unrealizedPnl: number | null;
	closedAt: string;
	/** DB order ID (set after DB close, used for adjustment tracking) */
	orderId?: string;
}

const canonicalSymbol = (symbol: string | undefined | null) => {
	if (!symbol) return "";
	return toCanonical(symbol).toUpperCase();
};

const buildSummary = (
	requestedSymbol: string,
	position: OpenPositionSummary,
	exitPrice: number | null,
	closedAtIso: string,
): ClosedPositionSummary => {
	if (!Number.isFinite(position.quantity) || position.quantity === 0) {
		throw new Error(`Invalid position quantity for ${requestedSymbol}`);
	}
	if (position.entryPrice == null) {
		throw new Error(`Missing entry price for ${requestedSymbol}`);
	}
	if (position.markPrice == null) {
		throw new Error(`Missing mark price for ${requestedSymbol}`);
	}

	const absQuantity = Math.abs(position.quantity);
	const entryPrice = position.entryPrice;
	const markPrice = position.markPrice;
	const resolvedExitPrice = exitPrice ?? markPrice;
	// Prefer Alpaca's cost_basis (avg_entry_price × qty) over manual recomputation
	const entryNotional = position.costBasis
		?? (entryPrice != null && absQuantity != null
			? entryPrice * absQuantity
			: null);
	const exitNotional =
		resolvedExitPrice != null && absQuantity != null
			? resolvedExitPrice * absQuantity
			: null;
	const realizedPnl = normalizeNumber(position.realizedPnl);
	const unrealizedPnl = normalizeNumber(position.unrealizedPnl);

	let netPnl: number | null = null;
	if (
		entryPrice != null &&
		resolvedExitPrice != null &&
		absQuantity != null
	) {
		const isLong = position.sign === "LONG";
		netPnl =
			(isLong
				? resolvedExitPrice - entryPrice
				: entryPrice - resolvedExitPrice) * absQuantity;
	} else if (realizedPnl != null || unrealizedPnl != null) {
		netPnl = (realizedPnl ?? 0) + (unrealizedPnl ?? 0);
	}

	return {
		symbol: requestedSymbol,
		side: position.sign,
		quantity: absQuantity,
		entryPrice,
		exitPrice: resolvedExitPrice,
		markPrice,
		entryNotional,
		exitNotional,
		netPnl,
		realizedPnl,
		unrealizedPnl,
		closedAt: closedAtIso,
	};
};

export async function closePosition(
	account: Account,
	symbols: string[],
): Promise<ClosedPositionSummary[]> {
	if (!symbols || symbols.length === 0) {
		return [];
	}

	const closedAtIso = new Date().toISOString();
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	// Fetch current open positions from our DB-enriched view for summary building
	const openPositions = await getOpenPositions(account);
	const positionMap = new Map<string, OpenPositionSummary>();
	for (const position of openPositions ?? []) {
		positionMap.set(canonicalSymbol(position.symbol), position);
	}

	const summaries: ClosedPositionSummary[] = [];

	for (const symbol of symbols) {
		const key = canonicalSymbol(symbol);
		const position = positionMap.get(key);
		if (!position) {
			console.warn(
				`No open position found for ${symbol}, skipping close request`,
			);
			continue;
		}

		try {
			const alpacaSymbol = toAlpacaSymbol(symbol);

			// For crypto: cancel independent SL/TP orders before closing.
			// Bracket orders (equities) auto-cancel, but crypto uses standalone orders.
			if (alpacaSymbol.includes("/")) {
				const openOrders = await trading.listOrders({
					status: "open",
					symbols: [alpacaSymbol],
				});
				for (const order of openOrders) {
					try {
						await trading.cancelOrder(order.id);
					} catch (cancelErr) {
						throw new Error(
							`Failed to cancel open crypto order ${order.id} for ${symbol}: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`,
						);
					}
				}
			}

			// Close position via Alpaca — for equities this also cancels bracket legs
			const closeResult = await trading.closePosition(alpacaSymbol);

			// Extract exit price from close order
			const exitPrice = closeResult.filled_avg_price
				? Number.parseFloat(closeResult.filled_avg_price)
				: position.markPrice ?? null;

			const summary = buildSummary(
				symbol,
				position,
				exitPrice,
				closedAtIso,
			);

			summaries.push(summary);

			const dbOrder = await getOpenOrderBySymbol(
				account.id,
				key,
			);
			if (!dbOrder) {
				throw new Error(
					`No DB OPEN order found for ${symbol} (accountId=${account.id}, key=${key})`,
				);
			}
			if (exitPrice == null) {
				throw new Error(
					`Missing exit price for ${symbol} after close order ${closeResult.id}`,
				);
			}
			if (summary.netPnl == null) {
				throw new Error(`Missing net PnL for ${symbol} close summary`);
			}

			await closeOrder({
				orderId: dbOrder.id,
				exitPrice: exitPrice.toString(),
				realizedPnl: summary.netPnl.toString(),
			});
			summary.orderId = dbOrder.id;
		} catch (err) {
			console.error(`Failed to close position for ${symbol}:`, err);
		}
	}

	return summaries;
}


