import { ExchangeSimulator } from "@//server/features/simulator/exchangeSimulator";
import {
	API_KEY_INDEX,
	BASE_URL,
	DEFAULT_SIMULATOR_OPTIONS,
	IS_SIMULATION_ENABLED,
} from "@/env";
import type { OrderSide } from "@/server/features/simulator/types";
import type { Account } from "@/server/features/trading/accounts";
import { SignerClient } from "@/server/features/trading/signerClient";
import { MARKETS } from "@/shared/markets/marketMetadata";
import {
	CandlestickApi,
	IsomorphicFetchHttpLibrary,
	ServerConfiguration,
} from "@/lighter/generated/index";
import { NonceManagerType } from "../../../../lighter-sdk-ts/nonce_manager";

export interface PositionRequest {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	confidence: number | null;
}

export interface PositionResult {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	success: boolean;
	error?: string;
}

export async function createPosition(
	account: Account,
	positions: PositionRequest[],
): Promise<PositionResult[]> {
	if (!positions || positions.length === 0) {
		return [];
	}

	if (IS_SIMULATION_ENABLED) {
		const simulator = await ExchangeSimulator.bootstrap(
			DEFAULT_SIMULATOR_OPTIONS,
		);
		const accountId = account.id || "default";
		const results: PositionResult[] = [];

		for (const {
			symbol,
			side,
			quantity,
			leverage,
			confidence,
			profitTarget,
			stopLoss,
			invalidationCondition,
		} of positions) {
			if (side === "HOLD") {
				results.push({ symbol, side, quantity, leverage, success: true });
				continue;
			}

			const orderSide: OrderSide = side === "LONG" ? "buy" : "sell";
			const orderQuantity = Math.abs(quantity);
			try {
				const execution = await simulator.placeOrder(
					{
						symbol,
						side: orderSide,
						quantity: orderQuantity,
						type: "market",
						leverage: leverage ?? undefined,
						confidence: confidence ?? undefined,
						exitPlan: {
							stop: stopLoss ?? null,
							target: profitTarget ?? null,
							invalidation: invalidationCondition ?? null,
						},
					},
					accountId,
				);

				if (execution.status === "rejected" || execution.totalQuantity === 0) {
					results.push({
						symbol,
						side,
						quantity,
						leverage,
						success: false,
						error: execution.reason ?? "Order rejected",
					});
				} else {
					results.push({ symbol, side, quantity, leverage, success: true });
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: message,
				});
			}
		}

		return results;
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

	const results: PositionResult[] = [];

	for (const { symbol, side, quantity, leverage } of positions) {
		try {
			const market = MARKETS[symbol as keyof typeof MARKETS];
			if (!market) {
				console.warn(`Market for symbol ${symbol} not found, skipping`);
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: "Market not found",
				});
				continue;
			}

			if (side === "HOLD") {
				console.log(`Side is HOLD for ${symbol}, skipping`);
				results.push({ symbol, side, quantity, leverage, success: true });
				continue;
			}

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
				console.warn(`No latest price found for ${symbol}, skipping`);
				results.push({
					symbol,
					side,
					quantity,
					leverage,
					success: false,
					error: "No latest price available",
				});
				continue;
			}

			const directionIsLong = side === "LONG";
			const orderQuantity = Math.abs(quantity);
			const response = await client.createOrder({
				marketIndex: market.marketId,
				clientOrderIndex: market.clientOrderIndex,
				baseAmount: Math.round(orderQuantity * market.qtyDecimals),
				price: Math.round(
					(directionIsLong ? latestPrice * 1.01 : latestPrice * 0.99) *
						market.priceDecimals,
				),
				isAsk: !directionIsLong,
				orderType: SignerClient.ORDER_TYPE_MARKET,
				timeInForce: SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
				reduceOnly: 0,
				triggerPrice: SignerClient.NIL_TRIGGER_PRICE,
				orderExpiry: SignerClient.DEFAULT_IOC_EXPIRY,
			});
			console.log(`Position created for ${symbol}:`, response);
			results.push({ symbol, side, quantity, leverage, success: true });
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			console.error(`Failed to create position for ${symbol}:`, err);
			results.push({
				symbol,
				side,
				quantity,
				leverage,
				success: false,
				error: errorMsg,
			});
		}
	}

	return results;
}
