/**
 * Get Portfolio (Alpaca)
 *
 * Fetches portfolio snapshot from Alpaca's account endpoint.
 * Single Alpaca code path.
 */

import type { Account } from "@/server/features/trading/contracts/accounts";
import { getTradingProvider } from "@/server/providers/alpaca";

export type PortfolioSnapshot = {
	totalValue: number;
	availableCash: number;
};

export async function getPortfolio(
	account: Account,
): Promise<PortfolioSnapshot> {
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	const alpacaAccount = await trading.getAccount();

	const totalValue = alpacaAccount.portfolio_value;
	const availableCash = alpacaAccount.cash;

	return {
		totalValue,
		availableCash,
	};
}
