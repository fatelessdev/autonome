import {
	BASE_URL,
	DEFAULT_SIMULATOR_OPTIONS,
	IS_SIMULATION_ENABLED,
} from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { PositionSummary } from "@/server/features/simulator/types";
import type { TradingSignal } from "@/server/features/trading/tradingDecisions";
import {
	AccountApi,
	ApiKeyAuthentication,
	IsomorphicFetchHttpLibrary,
	ServerConfiguration,
} from "../../../../lighter-sdk-ts/generated";

export interface ExitPlanSummary {
	target: number | null;
	stop: number | null;
	invalidation: string | null;
}

export interface OpenPositionSummary {
	symbol: string;
	position: string;
	quantity: number;
	sign: "LONG" | "SHORT";
	unrealizedPnl: string;
	realizedPnl: string;
	liquidationPrice: string | null;
	leverage?: number;
	notional?: string;
	entryPrice?: number | null;
	markPrice?: number | null;
	exitPlan?: ExitPlanSummary | null;
	confidence?: number | null;
	signal?: TradingSignal;
	lastDecisionAt?: string | null;
	decisionStatus?: string | null;
}

const toNumber = (value: unknown): number | null => {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

type GetOpenPositionsOptions = {
	fallbackToSimulator?: boolean;
};

const resolveAccountId = (accountId?: string): string => {
	if (accountId && accountId.length > 0) {
		return accountId;
	}
	return "default";
};

const mapSimulatorPositions = (
	positions: PositionSummary[],
): OpenPositionSummary[] =>
	positions.map((position) => {
		const quantity = position.quantity;
		const entryPrice = position.avgEntryPrice ?? null;
		const notionalEntry = Number.isFinite(position.notional)
			? position.notional
			: entryPrice != null
				? entryPrice * Math.abs(quantity)
				: position.markPrice != null
					? position.markPrice * Math.abs(quantity)
					: null;
		const leverage =
			position.leverage != null && Number.isFinite(position.leverage)
				? position.leverage
				: undefined;

		return {
			symbol: position.symbol,
			position: position.quantity.toFixed(4),
			quantity,
			sign: position.side,
			unrealizedPnl: position.unrealizedPnl.toFixed(2),
			realizedPnl: position.realizedPnl.toFixed(2),
			liquidationPrice: null,
			leverage,
			notional: notionalEntry != null ? notionalEntry.toFixed(2) : undefined,
			entryPrice,
			markPrice: position.markPrice ?? null,
			exitPlan: position.exitPlan ?? null,
			confidence: null,
			signal: position.side,
			lastDecisionAt: null,
			decisionStatus: null,
		};
	});

const loadSimulatorPositions = async (accountId?: string) => {
	const simulator = await ExchangeSimulator.bootstrap(
		DEFAULT_SIMULATOR_OPTIONS,
	);
	const simulatorAccountId = resolveAccountId(accountId);
	return mapSimulatorPositions(simulator.getOpenPositions(simulatorAccountId));
};

export async function getOpenPositions(
	apiKey: string,
	accountIndex: string,
	accountId?: string,
	options: GetOpenPositionsOptions = {},
): Promise<OpenPositionSummary[]> {
	if (IS_SIMULATION_ENABLED) {
		return loadSimulatorPositions(accountId);
	}

	const accountApi = new AccountApi({
		baseServer: new ServerConfiguration(BASE_URL, {}),
		httpApi: new IsomorphicFetchHttpLibrary(),
		middleware: [],
		authMethods: {
			apiKey: new ApiKeyAuthentication(apiKey),
		},
	});

	try {
		const currentOpenOrders = await accountApi.accountWithHttpInfo(
			"index",
			accountIndex,
		);
		const positions = currentOpenOrders.data.accounts[0]?.positions ?? [];

		if (options.fallbackToSimulator && (!positions || positions.length === 0)) {
			const simulatorPositions = await loadSimulatorPositions(accountId);
			if (simulatorPositions.length > 0) {
				console.warn(
					`[Positions] Using simulator snapshot for account ${resolveAccountId(accountId)} because exchange returned no positions.`,
				);
				return simulatorPositions;
			}
		}

		return positions.map((accountPosition) => {
			const quantity = toNumber(accountPosition.position) ?? 0;
			const entryPrice = toNumber(accountPosition.avgEntryPrice);
			const positionValue = toNumber(accountPosition.positionValue);
			const markPrice =
				positionValue != null && quantity !== 0
					? positionValue / Math.abs(quantity)
					: toNumber(accountPosition.avgEntryPrice);

			return {
				symbol: accountPosition.symbol,
				position: accountPosition.position,
				quantity,
				sign: accountPosition.sign === 1 ? "LONG" : "SHORT",
				unrealizedPnl: accountPosition.unrealizedPnl,
				realizedPnl: accountPosition.realizedPnl,
				liquidationPrice: accountPosition.liquidationPrice,
				leverage: undefined,
				notional: accountPosition.positionValue,
				entryPrice,
				markPrice,
				exitPlan: null,
				confidence: null,
				signal: accountPosition.sign === 1 ? "LONG" : "SHORT",
				lastDecisionAt: null,
				decisionStatus: null,
			};
		});
	} catch (rawError) {
		const error =
			rawError instanceof Error ? rawError : new Error(String(rawError));
		if (options.fallbackToSimulator) {
			console.warn(
				`[Positions] Falling back to simulator snapshot for account ${resolveAccountId(accountId)}: ${error.message}`,
			);
			return loadSimulatorPositions(accountId);
		}
		throw error;
	}
}
