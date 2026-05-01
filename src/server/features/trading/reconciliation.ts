/**
 * Position Reconciliation
 *
 * Compares DB OPEN orders against Alpaca live positions.
 * Orphaned DB orders (Alpaca position already closed but DB still OPEN)
 * are marked CLOSED with closeTrigger: "RECONCILE" and populated with
 * the actual exit price and realized P&L from Alpaca.
 *
 * Exit price resolution priority:
 *   1. Alpaca closed order fill price (most accurate)
 *   2. Current market price from Alpaca market data (fallback estimate)
 *   3. Entry price from DB order (last resort)
 *
 * Runs after all model trades complete in each trade cycle.
 */

import {
	toAlpacaSymbol,
	toCanonical,
} from "@/core/shared/markets/marketMetadata";
import {
	closeOrder,
	getAllOpenOrders,
	type OrderWithModel,
} from "@/server/db/ordersRepository.server";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getOpenPositions } from "@/server/features/trading/data/positions";
import {
	getMarketDataProvider,
	getTradingProvider,
} from "@/server/providers/alpaca";

export interface ReconciliationResult {
	/** Number of orphaned DB orders that were closed */
	orphanedClosed: number;
	/** Number of positions that matched between DB and Alpaca */
	matchedKept: number;
	/** Symbols of orphaned orders that were closed */
	orphanedSymbols: string[];
}

/**
 * Batch-fetch the most recent Alpaca fill price for each orphaned symbol.
 *
 * Queries Alpaca's closed orders endpoint once for all orphaned symbols,
 * then maps each canonical symbol to the filled_avg_price of its most
 * recent closed order.
 */
async function fetchAlpacaExitPrices(
	trading: ReturnType<typeof getTradingProvider>,
	orphanedOrders: OrderWithModel[],
): Promise<Map<string, number>> {
	const exitPrices = new Map<string, number>();

	// Deduplicate Alpaca symbols for the batch query
	const seen = new Set<string>();
	const alpacaSymbols: string[] = [];
	const canonicalByAlpaca = new Map<string, string>();

	for (const order of orphanedOrders) {
		const canonical = toCanonical(order.symbol).toUpperCase();
		try {
			const alpacaSymbol = toAlpacaSymbol(canonical);
			if (!seen.has(alpacaSymbol)) {
				seen.add(alpacaSymbol);
				alpacaSymbols.push(alpacaSymbol);
				canonicalByAlpaca.set(alpacaSymbol, canonical);
			}
		} catch {
			// Unsupported symbol — skip
		}
	}

	if (alpacaSymbols.length === 0) return exitPrices;

	try {
		const closedOrders = await trading.listOrders({
			status: "closed",
			symbols: alpacaSymbols,
			limit: 50,
			direction: "desc",
		});

		// For each symbol, take the first (most recent) order with a valid fill price
		for (const closedOrder of closedOrders) {
			const canonical =
				canonicalByAlpaca.get(closedOrder.symbol) ??
				toCanonical(closedOrder.symbol).toUpperCase();

			if (!exitPrices.has(canonical) && closedOrder.filled_avg_price) {
				const price = Number.parseFloat(closedOrder.filled_avg_price);
				if (Number.isFinite(price) && price > 0) {
					exitPrices.set(canonical, price);
				}
			}
		}
	} catch (error) {
		console.warn(
			`[Reconciliation] Failed to fetch Alpaca closed orders:`,
			error instanceof Error ? error.message : error,
		);
	}

	return exitPrices;
}

/**
 * Fetch the current market price for a symbol as a fallback exit price estimate.
 * Returns null if unavailable.
 */
async function fetchMarketPrice(
	account: Account,
	alpacaSymbol: string,
): Promise<number | null> {
	try {
		const marketData = getMarketDataProvider(
			account.alpacaApiKey,
			account.alpacaApiSecret,
		);
		const snapshot = await marketData.getCryptoSnapshot(alpacaSymbol);
		if (
			snapshot?.latest_trade?.price &&
			Number.isFinite(snapshot.latest_trade.price)
		) {
			return snapshot.latest_trade.price;
		}
	} catch (error) {
		console.warn(
			`[Reconciliation] Failed to fetch market price for ${alpacaSymbol}:`,
			error instanceof Error ? error.message : error,
		);
	}
	return null;
}

/**
 * Resolve the exit price for an orphaned order using the priority chain:
 *   1. Alpaca fill price (pre-fetched batch data)
 *   2. Current market price
 *   3. Entry price (last resort)
 */
async function resolveExitPrice(
	order: OrderWithModel,
	canonicalSymbol: string,
	account: Account,
	alpacaExitPrices: Map<string, number>,
): Promise<{ exitPrice: number; source: "alpaca_fill" | "market" | "entry" }> {
	// Priority 1: Alpaca fill price
	const alpacaPrice = alpacaExitPrices.get(canonicalSymbol);
	if (alpacaPrice !== undefined) {
		return { exitPrice: alpacaPrice, source: "alpaca_fill" };
	}

	// Priority 2: Current market price
	try {
		const alpacaSymbol = toAlpacaSymbol(canonicalSymbol);
		const marketPrice = await fetchMarketPrice(account, alpacaSymbol);
		if (marketPrice !== null) {
			return { exitPrice: marketPrice, source: "market" };
		}
	} catch {
		// Unsupported symbol — fall through
	}

	// Priority 3: Entry price (last resort)
	const entryPrice = Number.parseFloat(order.entryPrice);
	return {
		exitPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
		source: "entry",
	};
}

/**
 * Reconcile DB OPEN orders against Alpaca live positions for a single account.
 *
 * For each DB OPEN order belonging to this model, checks if a matching Alpaca
 * position exists (using canonical symbol comparison). Orders without a matching
 * Alpaca position are considered orphaned and closed with closeTrigger: "RECONCILE".
 *
 * Before closing, fetches the actual exit price from Alpaca's closed order history
 * and calculates realized P&L. Falls back to current market price, then entry price
 * if Alpaca fill data is unavailable.
 *
 * @param account - The trading account to reconcile
 * @param preloadedOrders - Optional pre-fetched open orders to avoid redundant DB query
 */
export async function reconcilePositions(
	account: Account,
	preloadedOrders?: OrderWithModel[],
): Promise<ReconciliationResult> {
	const result: ReconciliationResult = {
		orphanedClosed: 0,
		matchedKept: 0,
		orphanedSymbols: [],
	};

	// Fetch live Alpaca positions and build a canonical symbol set
	const alpacaPositions = await getOpenPositions(account);
	const alpacaSymbolSet = new Set<string>();
	for (const pos of alpacaPositions) {
		alpacaSymbolSet.add(toCanonical(pos.symbol).toUpperCase());
	}

	// Reuse pre-loaded orders when available to avoid redundant DB query
	const allOpenOrders = preloadedOrders ?? (await getAllOpenOrders());
	const modelOpenOrders = allOpenOrders.filter(
		(order) => order.modelId === account.id,
	);

	// First pass: classify orders as matched or orphaned
	const orphanedOrders: OrderWithModel[] = [];
	for (const order of modelOpenOrders) {
		const canonicalSymbol = toCanonical(order.symbol).toUpperCase();
		if (alpacaSymbolSet.has(canonicalSymbol)) {
			result.matchedKept++;
		} else {
			orphanedOrders.push(order);
		}
	}

	if (orphanedOrders.length === 0) {
		console.log(
			`[Reconciliation] ${account.name}: all ${result.matchedKept} DB orders match Alpaca positions`,
		);
		return result;
	}

	// Batch-fetch actual exit prices from Alpaca for all orphaned symbols
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);
	const alpacaExitPrices = await fetchAlpacaExitPrices(trading, orphanedOrders);

	// Close each orphaned order with resolved exit price and calculated P&L
	for (const order of orphanedOrders) {
		const canonicalSymbol = toCanonical(order.symbol).toUpperCase();
		const entryPrice = Number.parseFloat(order.entryPrice);
		const quantity = Number.parseFloat(order.quantity);

		const { exitPrice, source } = await resolveExitPrice(
			order,
			canonicalSymbol,
			account,
			alpacaExitPrices,
		);

		// Calculate realized P&L
		let realizedPnl = 0;
		if (
			Number.isFinite(entryPrice) &&
			Number.isFinite(quantity) &&
			quantity > 0
		) {
			realizedPnl =
				order.side === "LONG"
					? (exitPrice - entryPrice) * quantity
					: (entryPrice - exitPrice) * quantity;
		}

		await closeOrder({
			orderId: order.id,
			exitPrice: exitPrice.toString(),
			realizedPnl: realizedPnl.toString(),
			closeTrigger: "RECONCILE",
		});

		result.orphanedClosed++;
		result.orphanedSymbols.push(canonicalSymbol);

		console.warn(
			`[Reconciliation] Closed orphaned DB order ${order.id} for ${canonicalSymbol} (${account.name}): ` +
				`exit=$${exitPrice.toFixed(2)} [${source}], P&L=$${realizedPnl.toFixed(2)}`,
		);
	}

	if (result.orphanedClosed > 0) {
		console.warn(
			`[Reconciliation] ${account.name}: closed ${result.orphanedClosed} orphaned order(s): ${result.orphanedSymbols.join(", ")}`,
		);
	}

	return result;
}
