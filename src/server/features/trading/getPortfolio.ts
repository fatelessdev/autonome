import axios from "axios";
import {
	BASE_URL,
	DEFAULT_SIMULATOR_OPTIONS,
	IS_SIMULATION_ENABLED,
} from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { Account } from "@/server/features/trading/accounts";

export type PortfolioSnapshot = {
	totalValue: number;
	availableCash: number;
	total: string;
	available: string;
};

const normalizeNumber = (value: unknown): number | null => {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const formatCurrencyString = (value: number): string => value.toFixed(2);

type GetPortfolioOptions = {
	fallbackToSimulator?: boolean;
};

const resolveAccountId = (account: Account): string => {
	if (account.id && account.id.trim().length > 0) {
		return account.id;
	}

	if (account.accountIndex && account.accountIndex.trim().length > 0) {
		return account.accountIndex;
	}

	return "default";
};

const loadSimulatorPortfolio = async (
	account: Account,
): Promise<PortfolioSnapshot> => {
	const simulator = await ExchangeSimulator.bootstrap(
		DEFAULT_SIMULATOR_OPTIONS,
	);
	const accountId = resolveAccountId(account);
	const snapshot = simulator.getAccountSnapshot(accountId);

	const equityValue = Number.isFinite(snapshot.equity) ? snapshot.equity : 0;
	const usableFromSnapshot = Number.isFinite(snapshot.availableCash)
		? snapshot.availableCash
		: undefined;
	const marginBalance = Number.isFinite(snapshot.marginBalance)
		? snapshot.marginBalance
		: 0;
	const fallbackUsable = Math.max(equityValue - marginBalance, 0);
	const availableCash = Math.max(usableFromSnapshot ?? fallbackUsable, 0);

	return {
		totalValue: equityValue,
		availableCash,
		total: formatCurrencyString(equityValue),
		available: formatCurrencyString(availableCash),
	};
};

export async function getPortfolio(
	account: Account,
	options: GetPortfolioOptions = {},
): Promise<PortfolioSnapshot> {
	if (IS_SIMULATION_ENABLED) {
		return loadSimulatorPortfolio(account);
	}

	try {
		const response = await axios.get(
			`${BASE_URL}/api/v1/account?by=index&value=${account.accountIndex}`,
		);

		const accountData = response.data?.accounts?.[0] ?? {};
		const totalValue = normalizeNumber(accountData.total_asset_value) ?? 0;
		const rawAvailable = normalizeNumber(accountData.available_balance);

		const cappedAvailable =
			totalValue > 0 && rawAvailable != null
				? Math.min(rawAvailable, totalValue)
				: (rawAvailable ?? totalValue);

		const availableCash = Math.max(cappedAvailable ?? 0, 0);

		return {
			totalValue,
			availableCash,
			total: formatCurrencyString(totalValue),
			available: formatCurrencyString(availableCash),
		};
	} catch (rawError) {
		const error =
			rawError instanceof Error ? rawError : new Error(String(rawError));
		if (options.fallbackToSimulator) {
			console.warn(
				`[Portfolio] Falling back to simulator snapshot for account ${resolveAccountId(account)}: ${error.message}`,
			);
			return loadSimulatorPortfolio(account);
		}
		throw error;
	}
}
