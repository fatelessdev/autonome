import {
	calculateCurrentDrawdown,
	calculateMaxDrawdown,
	calculateRecoveryFactor,
	calculateReturnPercent,
	calculateSharpeRatioFromTrades,
	calculateWinRate,
} from "@/core/shared/trading/calculations";
import type { Order } from "@/db/schema";
import { getClosedOrdersByModel } from "@/server/db/ordersRepository.server";
import { getSharpeRatio } from "@/server/features/portfolio/welfordService";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getTradingProvider } from "@/server/providers/alpaca";

export type PerformanceMetrics = {
	sharpeRatio: string;
	/** Sharpe ratio computed via Welford's online algorithm from portfolio returns */
	welfordSharpeRatio: string;
	totalReturnPercent: string;
	/** Realized P&L from all closed trades (historical) */
	closedTradeRealizedPnl: number;
	/** Number of completed trades */
	tradeCount: number;
	/** Win rate as percentage string (e.g., "65.0%") */
	winRate: string;
	/** Current drawdown from peak as percentage string (e.g., "5.2%") */
	currentDrawdown: string;
	/** Maximum historical drawdown as percentage string (e.g., "12.3%") */
	maxDrawdown: string;
	/** Recovery factor = net profit / max absolute drawdown */
	recoveryFactor: string;
};

const parseRequiredRealizedPnl = (
	value: string | null,
	orderId: string,
): number => {
	if (value == null) {
		throw new Error(`Closed order ${orderId} is missing realizedPnl`);
	}
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(
			`Closed order ${orderId} has invalid realizedPnl: ${value}`,
		);
	}
	return parsed;
};

/**
 * Calculate trade-based Sharpe ratio and total realized P&L from the same
 * closed-orders query. Avoids querying the orders table three separate times
 * (getTotalRealizedPnl + getClosedOrdersByModel + calculateTradeSharpe).
 */
function calculateTradeStatsFromOrders(closedOrders: Order[]): {
	sharpeRatio: string;
	closedTradeRealizedPnl: number;
	tradeCount: number;
	winRate: string;
} {
	const pnls = closedOrders.map((order) =>
		parseRequiredRealizedPnl(order.realizedPnl, order.id),
	);
	const closedTradeRealizedPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
	const tradeCount = closedOrders.length;
	const winRate =
		tradeCount > 0 ? `${calculateWinRate(pnls).toFixed(1)}%` : "N/A";

	let sharpeRatio: string;
	if (pnls.length < 2) {
		sharpeRatio = "N/A (need more trades)";
	} else {
		const sharpe = calculateSharpeRatioFromTrades(pnls);
		sharpeRatio =
			Number.isFinite(sharpe) && Math.abs(sharpe) <= 100
				? sharpe.toFixed(2)
				: "N/A (insufficient data)";
	}

	return { sharpeRatio, closedTradeRealizedPnl, tradeCount, winRate };
}

export async function calculatePerformanceMetrics(
	account: Account,
	currentPortfolioValue: number,
): Promise<PerformanceMetrics> {
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	// Single DB query for closed orders (replaces 2 separate queries: getTotalRealizedPnl + getClosedOrdersByModel)
	const [alpacaHistory, closedOrders] = await Promise.all([
		trading.getPortfolioHistory({
			period: "1M",
			timeframe: "1D",
			intraday_reporting: "continuous",
		}),
		getClosedOrdersByModel(account.id),
	]);

	const { sharpeRatio, closedTradeRealizedPnl, tradeCount, winRate } =
		calculateTradeStatsFromOrders(closedOrders);

	// Calculate drawdown from portfolio history
	const portfolioValues = alpacaHistory.equity.filter(Number.isFinite);
	const currentDrawdown =
		portfolioValues.length > 0
			? `${calculateCurrentDrawdown(portfolioValues).toFixed(1)}%`
			: "N/A";
	const maxDrawdown =
		portfolioValues.length > 1
			? `${calculateMaxDrawdown(portfolioValues).toFixed(1)}%`
			: "N/A";
	const recoveryFactor =
		portfolioValues.length > 1
			? calculateRecoveryFactor(portfolioValues).toFixed(2)
			: "N/A";

	// Get Welford-based Sharpe ratio (online algorithm from portfolio returns)
	const welfordResult = getSharpeRatio(account.id);
	const welfordSharpeRatio = welfordResult.isValid
		? welfordResult.sharpeRatio.toFixed(3)
		: (welfordResult.reason ?? "N/A");

	if (portfolioValues.length < 2) {
		if (alpacaHistory.base_value == null) {
			throw new Error(
				`Portfolio history missing base_value for model ${account.id}`,
			);
		}
		const fallbackReturn = calculateReturnPercent(
			currentPortfolioValue,
			alpacaHistory.base_value,
		);

		return {
			sharpeRatio: "N/A (need more data)",
			welfordSharpeRatio,
			totalReturnPercent: `${fallbackReturn.toFixed(2)}%`,
			closedTradeRealizedPnl,
			tradeCount,
			winRate,
			currentDrawdown,
			maxDrawdown,
			recoveryFactor,
		};
	}

	const profitLossPct = alpacaHistory.profit_loss_pct;
	const totalReturn =
		profitLossPct.length > 0
			? profitLossPct[profitLossPct.length - 1] * 100
			: calculateReturnPercent(
					currentPortfolioValue,
					alpacaHistory.base_value == null
						? (() => {
								throw new Error(
									`Portfolio history missing base_value for model ${account.id}`,
								);
							})()
						: alpacaHistory.base_value,
				);

	return {
		sharpeRatio,
		welfordSharpeRatio,
		totalReturnPercent: `${totalReturn.toFixed(2)}%`,
		closedTradeRealizedPnl,
		tradeCount,
		winRate,
		currentDrawdown,
		maxDrawdown,
		recoveryFactor,
	};
}
