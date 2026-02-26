/**
 * Open Positions (Alpaca)
 *
 * Fetches open positions from Alpaca's positions endpoint.
 * Returns normalized OpenPositionSummary for the trading agent and UI.
 * Single Alpaca code path.
 */

import type { Account } from "@/server/features/trading/contracts/accounts";
import type { TradingSignal } from "@/server/features/trading/contracts/tradingDecisions";
import { getTradingProvider } from "@/server/providers/alpaca";
import { toCanonical } from "@/shared/markets/marketMetadata";
import { getOpenOrdersByModel } from "@/server/db/ordersRepository.server";

export interface ExitPlanSummary {
	target: number | null;
	stop: number | null;
	invalidation: string | null;
	invalidationPrice: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
}

export interface OpenPositionSummary {
	symbol: string;
	position: string;
	quantity: number;
	sign: "LONG" | "SHORT";
	unrealizedPnl: string;
	realizedPnl: string;
	liquidationPrice: string | null;
	notional?: string;
	entryPrice?: number | null;
	markPrice?: number | null;
	/** Alpaca: avg_entry_price × qty (total cost basis) */
	costBasis?: number | null;
	/** Alpaca: unrealized intraday P&L in USD */
	unrealizedIntradayPl?: number | null;
	/** Alpaca: unrealized intraday P&L as decimal ratio */
	unrealizedIntradayPlpc?: number | null;
	/** Alpaca: percent change from last day's close to current price (decimal) */
	changeToday?: number | null;
	exitPlan?: ExitPlanSummary | null;
	confidence?: number | null;
	signal?: TradingSignal;
	lastDecisionAt?: string | null;
	decisionStatus?: string | null;
}

export async function getOpenPositions(
	account: Account,
): Promise<OpenPositionSummary[]> {
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	// Fetch positions from Alpaca and DB exit plans in parallel
	const [alpacaPositions, dbOrders] = await Promise.all([
		trading.getPositions(),
		getOpenOrdersByModel(account.id),
	]);

	// Build exit plan lookup from DB orders (keyed by canonical symbol)
	const exitPlanBySymbol = new Map<string, { exitPlan: ExitPlanSummary | null; confidence: number | null }>();
	for (const order of dbOrders) {
		const plan = order.exitPlan as {
			stop?: number | null;
			target?: number | null;
			invalidation?: string | null;
			invalidationPrice?: number | null;
			timeExit?: string | null;
			cooldownUntil?: string | null;
			confidence?: number | null;
		} | null;

		exitPlanBySymbol.set(toCanonical(order.symbol).toUpperCase(), {
			exitPlan: plan
				? {
						stop: plan.stop ?? null,
						target: plan.target ?? null,
						invalidation: plan.invalidation ?? null,
						invalidationPrice: plan.invalidationPrice ?? null,
						timeExit: plan.timeExit ?? null,
						cooldownUntil: plan.cooldownUntil ?? null,
					}
				: null,
			confidence: plan?.confidence ?? null,
		});
	}

	return alpacaPositions.map((pos) => {
		const canonical = toCanonical(pos.symbol);
		const dbInfo = exitPlanBySymbol.get(canonical.toUpperCase());

		return {
			symbol: canonical,
			position: pos.qty.toFixed(4),
			quantity: pos.qty,
			sign: pos.side === "long" ? "LONG" : "SHORT",
			unrealizedPnl: pos.unrealized_pl.toFixed(2),
			realizedPnl: "0.00", // Alpaca doesn't return realized P&L on positions
			liquidationPrice: null, // Alpaca paper trading has no liquidation
			notional: pos.market_value.toFixed(2),
			entryPrice: pos.avg_entry_price,
			markPrice: pos.current_price,
			costBasis: pos.cost_basis,
			unrealizedIntradayPl: pos.unrealized_intraday_pl,
			unrealizedIntradayPlpc: pos.unrealized_intraday_plpc,
			changeToday: pos.change_today,
			exitPlan: dbInfo?.exitPlan ?? null,
			confidence: dbInfo?.confidence ?? null,
			signal: pos.side === "long" ? "LONG" : "SHORT",
			lastDecisionAt: null,
			decisionStatus: null,
		};
	});
}

