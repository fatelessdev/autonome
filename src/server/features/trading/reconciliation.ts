/**
 * Position Reconciliation
 *
 * Compares DB OPEN orders against Alpaca live positions.
 * Orphaned DB orders (Alpaca position already closed but DB still OPEN)
 * are marked CLOSED with closeTrigger: "RECONCILE".
 *
 * Runs after all model trades complete in each trade cycle.
 */

import { toCanonical } from "@/core/shared/markets/marketMetadata";
import {
	closeOrder,
	getAllOpenOrders,
} from "@/server/db/ordersRepository.server";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getOpenPositions } from "@/server/features/trading/data/positions";

export interface ReconciliationResult {
	/** Number of orphaned DB orders that were closed */
	orphanedClosed: number;
	/** Number of positions that matched between DB and Alpaca */
	matchedKept: number;
	/** Symbols of orphaned orders that were closed */
	orphanedSymbols: string[];
}

/**
 * Reconcile DB OPEN orders against Alpaca live positions for a single account.
 *
 * For each DB OPEN order belonging to this model, checks if a matching Alpaca
 * position exists (using canonical symbol comparison). Orders without a matching
 * Alpaca position are considered orphaned and closed with closeTrigger: "RECONCILE".
 */
export async function reconcilePositions(
	account: Account,
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

	// Fetch all DB OPEN orders and filter to this model's orders
	const allOpenOrders = await getAllOpenOrders();
	const modelOpenOrders = allOpenOrders.filter(
		(order) => order.modelId === account.id,
	);

	for (const order of modelOpenOrders) {
		const canonicalSymbol = toCanonical(order.symbol).toUpperCase();

		if (alpacaSymbolSet.has(canonicalSymbol)) {
			result.matchedKept++;
			continue;
		}

		// Orphaned: DB says OPEN but Alpaca has no matching position
		const entryPrice = Number.parseFloat(order.entryPrice);
		const exitPrice = Number.isFinite(entryPrice) ? entryPrice : 0;

		await closeOrder({
			orderId: order.id,
			exitPrice: exitPrice.toString(),
			realizedPnl: "0",
			closeTrigger: "RECONCILE",
		});

		result.orphanedClosed++;
		result.orphanedSymbols.push(canonicalSymbol);

		console.warn(
			`[Reconciliation] Closed orphaned DB order ${order.id} for ${canonicalSymbol} (${account.name}): no matching Alpaca position`,
		);
	}

	if (result.orphanedClosed > 0) {
		console.warn(
			`[Reconciliation] ${account.name}: closed ${result.orphanedClosed} orphaned order(s): ${result.orphanedSymbols.join(", ")}`,
		);
	} else {
		console.log(
			`[Reconciliation] ${account.name}: all ${result.matchedKept} DB orders match Alpaca positions`,
		);
	}

	return result;
}
