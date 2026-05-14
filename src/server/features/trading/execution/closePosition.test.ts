import {
	beforeEach,
	describe,
	expect,
	it,
	type MockedFunction,
	vi,
} from "vitest";
import {
	closeOrder,
	getOpenOrderBySymbol,
} from "@/server/db/ordersRepository.server";
import type { Account } from "@/server/features/trading/contracts/accounts";
import {
	getOpenPositions,
	type OpenPositionSummary,
} from "@/server/features/trading/data/positions";
import { getTradingProvider } from "@/server/providers/alpaca";
import type { BrokerOrder, BrokerProvider } from "@/server/providers/types";

vi.mock("@/server/db/ordersRepository.server", () => ({
	closeOrder: vi.fn(),
	getOpenOrderBySymbol: vi.fn(),
}));

vi.mock("@/server/features/trading/data/positions", () => ({
	getOpenPositions: vi.fn(),
}));

vi.mock("@/server/providers/alpaca", () => ({
	getTradingProvider: vi.fn(),
}));

const mockGetTradingProvider = vi.mocked(getTradingProvider);
const mockGetOpenPositions = vi.mocked(getOpenPositions);
const mockGetOpenOrderBySymbol = vi.mocked(getOpenOrderBySymbol);
const mockCloseOrder = vi.mocked(closeOrder);

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: "model-1",
		name: "Test Model",
		modelName: "test/model",
		variant: "Sovereign",
		alpacaApiKey: "key",
		alpacaApiSecret: "secret",
		invocationCount: 1,
		totalMinutes: 5,
		...overrides,
	};
}

function makePosition(
	overrides: Partial<OpenPositionSummary> = {},
): OpenPositionSummary {
	return {
		symbol: "BTC",
		position: "1.0000",
		quantity: 1,
		side: "LONG",
		unrealizedPnl: 100,
		realizedPnl: 0,
		liquidationPrice: null,
		notional: "50000",
		entryPrice: 50000,
		markPrice: 50100,
		costBasis: 50000,
		unrealizedIntradayPl: 100,
		unrealizedIntradayPlpc: 0.002,
		changeToday: 0.002,
		exitPlan: null,
		confidence: null,
		lastDecisionAt: null,
		decisionStatus: null,
		...overrides,
	};
}

function makeBrokerOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
	return {
		id: "order-1",
		client_order_id: "client-order-1",
		symbol: "BTC/USD",
		asset_id: "asset-1",
		asset_class: "crypto",
		qty: "1",
		filled_qty: "1",
		filled_avg_price: "50100",
		order_class: "",
		order_type: "market",
		type: "market",
		side: "sell",
		time_in_force: "gtc",
		limit_price: null,
		stop_price: null,
		status: "filled",
		extended_hours: false,
		created_at: "2026-05-14T00:00:00.000Z",
		updated_at: "2026-05-14T00:00:00.000Z",
		submitted_at: "2026-05-14T00:00:00.000Z",
		filled_at: "2026-05-14T00:00:01.000Z",
		expired_at: null,
		canceled_at: null,
		failed_at: null,
		...overrides,
	};
}

describe("closePosition", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetOpenPositions.mockResolvedValue([makePosition()]);
		mockGetOpenOrderBySymbol.mockResolvedValue({
			id: "db-order-1",
		} as Awaited<ReturnType<typeof getOpenOrderBySymbol>>);
	});

	it("can be imported", async () => {
		const mod = await import("./closePosition");
		expect(mod).toBeDefined();
	});

	it("refuses to close crypto positions if standalone exit-order cancellation fails", async () => {
		const listOrders: MockedFunction<BrokerProvider["listOrders"]> = vi
			.fn()
			.mockResolvedValue([makeBrokerOrder({ id: "exit-order-1" })]);
		const cancelOrder: MockedFunction<BrokerProvider["cancelOrder"]> = vi
			.fn()
			.mockRejectedValue(new Error("cancel rejected"));
		const brokerClosePosition: MockedFunction<BrokerProvider["closePosition"]> =
			vi.fn().mockResolvedValue(makeBrokerOrder({ id: "close-order-1" }));

		mockGetTradingProvider.mockReturnValue({
			listOrders,
			cancelOrder,
			closePosition: brokerClosePosition,
		} as unknown as ReturnType<typeof getTradingProvider>);

		const { closePosition } = await import("./closePosition");

		await expect(closePosition(makeAccount(), ["BTC"])).rejects.toThrow(
			/refusing to close position while stale orders may remain live/,
		);

		expect(listOrders).toHaveBeenCalledWith({
			status: "open",
			symbols: ["BTC/USD"],
		});
		expect(cancelOrder).toHaveBeenCalledWith("exit-order-1");
		expect(brokerClosePosition).not.toHaveBeenCalled();
		expect(mockCloseOrder).not.toHaveBeenCalled();
	});
});
