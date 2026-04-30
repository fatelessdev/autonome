/**
 * Close Position (Alpaca)
 *
 * Closes open positions via Alpaca's position close endpoint.
 * Single Alpaca code path.
 * For equities: Alpaca automatically cancels attached bracket legs (SL/TP).
 * For crypto: we cancel independent SL/TP orders before closing the position.
 */

import {
	toAlpacaSymbol,
	toCanonical,
} from "@/core/shared/markets/marketMetadata";
import {
	requireFiniteNumber,
	requirePresent,
} from "@/core/shared/trading/calculations";
import {
	closeOrder,
	getOpenOrderBySymbol,
} from "@/server/db/ordersRepository.server";
import type { Account } from "@/server/features/trading/contracts/accounts";
import {
	getOpenPositions,
	type OpenPositionSummary,
} from "@/server/features/trading/data/positions";
import { getTradingProvider } from "@/server/providers/alpaca";

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

const canonicalSymbol = (symbol: string) => toCanonical(symbol).toUpperCase();

const parseOptionalPrice = (value: string | null): number | null => {
	if (value == null) {
		return null;
	}
	const parsed = Number.parseFloat(value);
	return requireFiniteNumber(parsed, "close order filled_avg_price");
};

const buildSummary = (
	requestedSymbol: string,
	position: OpenPositionSummary,
	exitPrice: number | null,
	closedAtIso: string,
): ClosedPositionSummary => {
	const quantity = requireFiniteNumber(
		position.quantity,
		`${requestedSymbol} quantity`,
	);
	if (quantity === 0) {
		throw new Error(`Invalid position quantity for ${requestedSymbol}`);
	}
	const entryPrice = requirePresent(
		position.entryPrice,
		`${requestedSymbol} entryPrice`,
	);
	const markPrice = requirePresent(
		position.markPrice,
		`${requestedSymbol} markPrice`,
	);

	const absQuantity = Math.abs(quantity);
	const resolvedExitPrice = exitPrice ?? markPrice;
	// Prefer Alpaca's cost_basis (avg_entry_price × qty) over manual recomputation
	const entryNotional = position.costBasis ?? entryPrice * absQuantity;
	const exitNotional = resolvedExitPrice * absQuantity;
	const realizedPnl = position.realizedPnl;
	const unrealizedPnl = position.unrealizedPnl;
	const isLong = position.side === "LONG";

	const directionalPnl =
		(isLong ? resolvedExitPrice - entryPrice : entryPrice - resolvedExitPrice) *
		absQuantity;

	let netPnl: number | null = Number.isFinite(directionalPnl)
		? directionalPnl
		: null;
	if (netPnl == null && (realizedPnl != null || unrealizedPnl != null)) {
		netPnl = (realizedPnl ?? 0) + (unrealizedPnl ?? 0);
	}

	return {
		symbol: requestedSymbol,
		side: position.side,
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
		throw new Error("closePosition requires at least one symbol");
	}

	const closedAtIso = new Date().toISOString();
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	// Fetch current open positions from our DB-enriched view for summary building
	const openPositions = await getOpenPositions(account);
	const positionMap = new Map<string, OpenPositionSummary>();
	for (const position of openPositions) {
		positionMap.set(canonicalSymbol(position.symbol), position);
	}

	const summaries: ClosedPositionSummary[] = [];

	for (const symbol of symbols) {
		const key = canonicalSymbol(symbol);
		const position = positionMap.get(key);
		if (!position) {
			throw new Error(
				`No open position found for ${symbol} (accountId=${account.id}, key=${key})`,
			);
		}

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

		// Close position via Alpaca - for equities this also cancels bracket legs
		const closeResult = await trading.closePosition(alpacaSymbol);

		// Extract exit price from close order
		const exitPrice = parseOptionalPrice(closeResult.filled_avg_price);

		const summary = buildSummary(
			symbol,
			position,
			exitPrice ?? position.markPrice ?? null,
			closedAtIso,
		);

		summaries.push(summary);

		const dbOrder = await getOpenOrderBySymbol(account.id, key);
		if (!dbOrder) {
			throw new Error(
				`No DB OPEN order found for ${symbol} (accountId=${account.id}, key=${key})`,
			);
		}
		const persistedExitPrice = requirePresent(
			exitPrice ?? position.markPrice,
			`${symbol} exit price after close order ${closeResult.id}`,
		);
		if (summary.netPnl == null) {
			throw new Error(`Missing net PnL for ${symbol} close summary`);
		}

		await closeOrder({
			orderId: dbOrder.id,
			exitPrice: persistedExitPrice.toString(),
			realizedPnl: summary.netPnl.toString(),
		});
		summary.orderId = dbOrder.id;
	}

	return summaries;
}
