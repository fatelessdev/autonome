import {
	API_KEY_INDEX,
	BASE_URL,
	DEFAULT_SIMULATOR_OPTIONS,
	IS_SIMULATION_ENABLED,
} from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { Account } from "@/server/features/trading/accounts";
import {
	getOpenPositions,
	type OpenPositionSummary,
} from "@/server/features/trading/openPositions";
import { SignerClient } from "@/server/features/trading/signerClient";
import { MARKETS } from "@/shared/markets/marketMetadata";
import {
	CandlestickApi,
	IsomorphicFetchHttpLibrary,
	ServerConfiguration,
} from "../../../../lighter-sdk-ts/generated";
import { NonceManagerType } from "../../../../lighter-sdk-ts/nonce_manager";

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
}

const canonicalSymbol = (symbol: string | undefined | null) => {
	if (!symbol) return "";
	return symbol
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.replace(/USDT$/, "");
};

const toNumber = (value: unknown): number | null => {
	if (value == null) return null;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string" && value.length > 0) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const buildSummary = (
	requestedSymbol: string,
	position: OpenPositionSummary | undefined,
	exitPrice: number | null,
	closedAtIso: string,
): ClosedPositionSummary | null => {
	if (!position) return null;

	const quantity = position.quantity ?? toNumber(position.position);
	const absQuantity = quantity != null ? Math.abs(quantity) : null;
	const entryPrice = position.entryPrice ?? position.markPrice ?? null;
	const markPrice = position.markPrice ?? entryPrice;
	const resolvedExitPrice = exitPrice ?? markPrice ?? entryPrice ?? null;
	const entryNotional =
		entryPrice != null && absQuantity != null ? entryPrice * absQuantity : null;
	const exitNotional =
		resolvedExitPrice != null && absQuantity != null
			? resolvedExitPrice * absQuantity
			: null;
	const realizedPnl = toNumber(position.realizedPnl);
	const unrealizedPnl = toNumber(position.unrealizedPnl);

	let netPnl: number | null = null;
	if (entryPrice != null && resolvedExitPrice != null && absQuantity != null) {
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
	const openPositions = await getOpenPositions(
		account.apiKey,
		account.accountIndex,
		account.id || "default",
	);
	const positionMap = new Map<string, OpenPositionSummary>();
	for (const position of openPositions ?? []) {
		positionMap.set(canonicalSymbol(position.symbol), position);
	}

	if (IS_SIMULATION_ENABLED) {
		const simulator = await ExchangeSimulator.bootstrap(
			DEFAULT_SIMULATOR_OPTIONS,
		);
		const accountId = account.id || "default";
		const outcomes = await simulator.closePositions(symbols, accountId);

		const summaries: ClosedPositionSummary[] = [];
		for (const symbol of symbols) {
			const key = canonicalSymbol(symbol);
			const position = positionMap.get(key);
			const outcome = outcomes[symbol] ?? outcomes[key];
			const exitPrice =
				outcome?.averagePrice && outcome.averagePrice > 0
					? outcome.averagePrice
					: null;
			const summary = buildSummary(symbol, position, exitPrice, closedAtIso);
			if (summary) summaries.push(summary);
		}
		return summaries;
	}

	const client = await SignerClient.create({
		url: BASE_URL,
		privateKey: account.apiKey,
		apiKeyIndex: API_KEY_INDEX,
		accountIndex: Number(account.accountIndex),
		nonceManagementType: NonceManagerType.API,
	});

	const candleStickApi = new CandlestickApi({
		baseServer: new ServerConfiguration(BASE_URL, {}),
		httpApi: new IsomorphicFetchHttpLibrary(),
		middleware: [],
		authMethods: {},
	});

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

		const market = MARKETS[symbol as keyof typeof MARKETS];
		if (!market) {
			console.warn(`Market for symbol ${symbol} not found, skipping`);
			continue;
		}

		try {
			const candleStickData = await candleStickApi.candlesticks(
				market.marketId,
				"1m",
				Date.now() - 1000 * 60 * 5,
				Date.now(),
				1,
				false,
			);
			const latestPrice =
				candleStickData?.candlesticks?.[candleStickData.candlesticks.length - 1]
					?.close;
			if (!latestPrice) {
				console.warn(
					`No latest price found for ${symbol}, skipping close request`,
				);
				continue;
			}

			const closeSign = position.sign === "LONG" ? "SHORT" : "LONG";

			const baseQuantity =
				position.quantity ?? toNumber(position.position) ?? 0;

			await client.createOrder({
				marketIndex: market.marketId,
				clientOrderIndex: market.clientOrderIndex,
				baseAmount: Math.abs(baseQuantity) * market.qtyDecimals,
				price:
					(closeSign === "LONG" ? latestPrice * 1.01 : latestPrice * 0.99) *
					market.priceDecimals,
				isAsk: closeSign !== "LONG",
				orderType: SignerClient.ORDER_TYPE_MARKET,
				timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
				reduceOnly: 0,
				triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
				orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
			});

			const summary = buildSummary(symbol, position, latestPrice, closedAtIso);
			if (summary) summaries.push(summary);
		} catch (err) {
			console.error(`Failed to close position for ${symbol}:`, err);
		}
	}

	return summaries;
}
