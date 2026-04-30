/**
 * Open Positions (Alpaca)
 *
 * Fetches open positions from Alpaca's positions endpoint.
 * Returns normalized OpenPositionSummary for the trading agent and UI.
 * Single Alpaca code path.
 */

import { toCanonical } from "@/core/shared/markets/marketMetadata";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getTradingProvider } from "@/server/providers/alpaca";

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
	side: "LONG" | "SHORT";
	unrealizedPnl: number;
	realizedPnl: number;
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

	const alpacaPositions = await trading.getPositions();

	return alpacaPositions.map((pos) => {
		const canonical = toCanonical(pos.symbol);

		return {
			symbol: canonical,
			position: pos.qty.toFixed(4),
			quantity: pos.qty,
			side: pos.side === "long" ? "LONG" : "SHORT",
			unrealizedPnl: pos.unrealized_pl,
			realizedPnl: 0, // Alpaca doesn't return realized P&L on positions
			liquidationPrice: null, // Alpaca paper trading has no liquidation
			notional: pos.market_value.toFixed(2),
			entryPrice: pos.avg_entry_price,
			markPrice: pos.current_price,
			costBasis: pos.cost_basis,
			unrealizedIntradayPl: pos.unrealized_intraday_pl,
			unrealizedIntradayPlpc: pos.unrealized_intraday_plpc,
			changeToday: pos.change_today,
			// Exit plan/confidence are merged later from latest tool-call decision metadata.
			exitPlan: null,
			confidence: null,
			lastDecisionAt: null,
			decisionStatus: null,
		};
	});
}
