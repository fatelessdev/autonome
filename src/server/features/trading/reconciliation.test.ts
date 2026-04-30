import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/server/features/trading/contracts/accounts";

// Mock dependencies before importing reconciliation
vi.mock("@/server/db/ordersRepository.server", () => ({
	closeOrder: vi.fn().mockResolvedValue({
		id: "closed-order",
		status: "CLOSED",
		closeTrigger: "RECONCILE",
	}),
	getAllOpenOrders: vi.fn().mockResolvedValue([]),
	getOpenOrderBySymbol: vi.fn(),
}));

vi.mock("@/server/features/trading/data/positions", () => ({
	getOpenPositions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/core/shared/markets/marketMetadata", () => ({
	toCanonical: (s: string) => s.replace("/USD", "").toUpperCase(),
}));

// Import after mocks are set up
const { reconcilePositions } = await import("./reconciliation");
const { closeOrder, getAllOpenOrders } = (await import(
	"@/server/db/ordersRepository.server"
)) as unknown as {
	closeOrder: ReturnType<typeof vi.fn>;
	getAllOpenOrders: ReturnType<typeof vi.fn>;
};
const { getOpenPositions } = (await import(
	"@/server/features/trading/data/positions"
)) as unknown as {
	getOpenPositions: ReturnType<typeof vi.fn>;
};

const makeAccount = (overrides: Partial<Account> = {}): Account => ({
	alpacaApiKey: "test-key",
	alpacaApiSecret: "test-secret",
	name: "TestModel",
	modelName: "TestModel",
	invocationCount: 1,
	id: "account-1",
	totalMinutes: 60,
	variant: "Sovereign",
	...overrides,
});

const makeDbOrder = (
	overrides: Partial<{
		id: string;
		modelId: string;
		symbol: string;
		side: "LONG" | "SHORT";
		quantity: string;
		entryPrice: string;
		status: "OPEN" | "CLOSED";
	}> = {},
) => ({
	id: overrides.id ?? "order-1",
	modelId: overrides.modelId ?? "account-1",
	symbol: overrides.symbol ?? "BTC",
	side: overrides.side ?? "LONG",
	quantity: overrides.quantity ?? "0.01",
	entryPrice: overrides.entryPrice ?? "50000",
	status: overrides.status ?? "OPEN",
	model: { name: "TestModel", openRouterModelName: "test/model" },
});

const makeAlpacaPosition = (
	overrides: Partial<{
		symbol: string;
		qty: number;
		side: string;
	}> = {},
) => ({
	symbol: overrides.symbol ?? "BTC/USD",
	position: String(overrides.qty ?? 0.01),
	quantity: overrides.qty ?? 0.01,
	side: overrides.side ?? "LONG",
	unrealizedPnl: 100,
	realizedPnl: 0,
	liquidationPrice: null,
	notional: "5000",
	entryPrice: 50000,
	markPrice: 51000,
	costBasis: 500,
	unrealizedIntradayPl: 10,
	unrealizedIntradayPlpc: 0.02,
	changeToday: 0.02,
});

describe("reconcilePositions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("can be imported", async () => {
		expect(reconcilePositions).toBeDefined();
	});

	it("matching positions stay open", async () => {
		getAllOpenOrders.mockResolvedValue([makeDbOrder({ symbol: "BTC" })]);
		getOpenPositions.mockResolvedValue([
			makeAlpacaPosition({ symbol: "BTC/USD" }),
		]);

		const result = await reconcilePositions(makeAccount());

		expect(result.matchedKept).toBe(1);
		expect(result.orphanedClosed).toBe(0);
		expect(result.orphanedSymbols).toEqual([]);
		expect(closeOrder).not.toHaveBeenCalled();
	});

	it("orphaned positions are closed with RECONCILE trigger", async () => {
		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-orphan", symbol: "BTC" }),
		]);
		getOpenPositions.mockResolvedValue([]); // No Alpaca positions

		const result = await reconcilePositions(makeAccount());

		expect(result.orphanedClosed).toBe(1);
		expect(result.matchedKept).toBe(0);
		expect(result.orphanedSymbols).toEqual(["BTC"]);
		expect(closeOrder).toHaveBeenCalledWith({
			orderId: "order-orphan",
			exitPrice: "50000",
			realizedPnl: "0",
			closeTrigger: "RECONCILE",
		});
	});

	it("logs each reconciliation action", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-orphan", symbol: "ETH" }),
		]);
		getOpenPositions.mockResolvedValue([]);

		await reconcilePositions(makeAccount({ name: "MyModel" }));

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Closed orphaned DB order order-orphan for ETH"),
		);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("closed 1 orphaned order(s): ETH"),
		);

		warnSpy.mockRestore();
		logSpy.mockRestore();
	});

	it("handles empty Alpaca positions (all DB orders are orphaned)", async () => {
		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-1", symbol: "BTC" }),
			makeDbOrder({ id: "order-2", symbol: "ETH" }),
		]);
		getOpenPositions.mockResolvedValue([]);

		const result = await reconcilePositions(makeAccount());

		expect(result.orphanedClosed).toBe(2);
		expect(result.matchedKept).toBe(0);
		expect(result.orphanedSymbols).toEqual(["BTC", "ETH"]);
		expect(closeOrder).toHaveBeenCalledTimes(2);
	});

	it("handles empty DB orders (nothing to reconcile)", async () => {
		getAllOpenOrders.mockResolvedValue([]);
		getOpenPositions.mockResolvedValue([
			makeAlpacaPosition({ symbol: "BTC/USD" }),
		]);

		const result = await reconcilePositions(makeAccount());

		expect(result.orphanedClosed).toBe(0);
		expect(result.matchedKept).toBe(0);
		expect(closeOrder).not.toHaveBeenCalled();
	});

	it("handles both empty (no DB orders, no Alpaca positions)", async () => {
		getAllOpenOrders.mockResolvedValue([]);
		getOpenPositions.mockResolvedValue([]);

		const result = await reconcilePositions(makeAccount());

		expect(result.orphanedClosed).toBe(0);
		expect(result.matchedKept).toBe(0);
		expect(closeOrder).not.toHaveBeenCalled();
	});

	it("filters orders by model ID", async () => {
		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-1", modelId: "account-1", symbol: "BTC" }),
			makeDbOrder({ id: "order-2", modelId: "account-2", symbol: "ETH" }),
		]);
		getOpenPositions.mockResolvedValue([]);

		const result = await reconcilePositions(makeAccount({ id: "account-1" }));

		// Only account-1's order should be reconciled
		expect(result.orphanedClosed).toBe(1);
		expect(closeOrder).toHaveBeenCalledTimes(1);
		expect(closeOrder).toHaveBeenCalledWith(
			expect.objectContaining({ orderId: "order-1" }),
		);
	});

	it("uses canonical symbol matching", async () => {
		// DB uses "BTC", Alpaca uses "BTC/USD" — both should match to "BTC"
		getAllOpenOrders.mockResolvedValue([makeDbOrder({ symbol: "BTC" })]);
		getOpenPositions.mockResolvedValue([
			makeAlpacaPosition({ symbol: "BTC/USD" }),
		]);

		const result = await reconcilePositions(makeAccount());

		expect(result.matchedKept).toBe(1);
		expect(result.orphanedClosed).toBe(0);
	});

	it("handles mixed matched and orphaned orders", async () => {
		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-matched", symbol: "BTC" }),
			makeDbOrder({ id: "order-orphan", symbol: "ETH" }),
		]);
		getOpenPositions.mockResolvedValue([
			makeAlpacaPosition({ symbol: "BTC/USD" }),
		]);

		const result = await reconcilePositions(makeAccount());

		expect(result.matchedKept).toBe(1);
		expect(result.orphanedClosed).toBe(1);
		expect(result.orphanedSymbols).toEqual(["ETH"]);
		expect(closeOrder).toHaveBeenCalledTimes(1);
		expect(closeOrder).toHaveBeenCalledWith(
			expect.objectContaining({ orderId: "order-orphan" }),
		);
	});

	it("uses entry price as exit price for orphaned orders", async () => {
		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-1", symbol: "BTC", entryPrice: "42500.50" }),
		]);
		getOpenPositions.mockResolvedValue([]);

		await reconcilePositions(makeAccount());

		expect(closeOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				orderId: "order-1",
				exitPrice: "42500.5",
				realizedPnl: "0",
				closeTrigger: "RECONCILE",
			}),
		);
	});

	it("sets exit price to 0 when entry price is not a number", async () => {
		getAllOpenOrders.mockResolvedValue([
			makeDbOrder({ id: "order-1", symbol: "BTC", entryPrice: "NaN" }),
		]);
		getOpenPositions.mockResolvedValue([]);

		await reconcilePositions(makeAccount());

		expect(closeOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				exitPrice: "0",
			}),
		);
	});

	it("emits log when all orders match", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		getAllOpenOrders.mockResolvedValue([makeDbOrder({ symbol: "BTC" })]);
		getOpenPositions.mockResolvedValue([
			makeAlpacaPosition({ symbol: "BTC/USD" }),
		]);

		await reconcilePositions(makeAccount({ name: "TestBot" }));

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("all 1 DB orders match Alpaca positions"),
		);
		expect(warnSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("orphaned"),
		);

		logSpy.mockRestore();
		warnSpy.mockRestore();
	});
});
