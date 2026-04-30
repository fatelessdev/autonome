import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/server/features/trading/contracts/accounts";

// Mock the provider module before importing createPosition
vi.mock("@/server/providers/alpaca", () => {
	const mockGetQuote = vi.fn();
	const mockGetAccount = vi.fn().mockResolvedValue({
		id: "acct-1",
		account_number: "12345",
		status: "ACTIVE",
		currency: "USD",
		cash: 10000,
		buying_power: 10000,
		regt_buying_power: 10000,
		daytrading_buying_power: 10000,
		equity: 10000,
		last_equity: 10000,
		long_market_value: 0,
		short_market_value: 0,
		portfolio_value: 10000,
		pattern_day_trader: false,
		trading_blocked: false,
		transfers_blocked: false,
		account_blocked: false,
		multiplier: "1",
		shorting_enabled: false,
		maintenance_margin: 0,
		initial_margin: 0,
		daytrade_count: 0,
		created_at: "2024-01-01",
	});
	return {
		getTradingProvider: vi.fn(() => ({
			createOrder: vi.fn().mockImplementation((params: { qty: number }) => ({
				id: "order-1",
				filled_avg_price: "100.00",
				filled_qty: String(params.qty),
			})),
			getOrder: vi.fn().mockImplementation((orderId: string) => ({
				id: orderId,
				filled_avg_price: "100.00",
				filled_qty: "1",
			})),
			getAccount: mockGetAccount,
		})),
		getMarketDataProvider: vi.fn(() => ({
			getQuote: mockGetQuote,
		})),
		__mockGetQuote: mockGetQuote,
		__mockGetAccount: mockGetAccount,
	};
});

vi.mock("@/server/db/ordersRepository.server", () => ({
	createOrder: vi.fn().mockImplementation((params: { quantity: string }) => ({
		id: "db-order-1",
		quantity: params.quantity,
		entryPrice: "100.00",
		side: "LONG",
	})),
	getOpenOrderBySymbol: vi.fn().mockResolvedValue(null),
	scaleIntoOrder: vi.fn(),
	updateAlpacaOrderId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/core/shared/markets/marketMetadata", () => ({
	toAlpacaSymbol: (s: string) => `${s}/USD`,
	toCanonical: (s: string) => s.replace("/USD", ""),
}));

// Import after mocks are set up
const { createPosition } = await import("./createPosition");
const { __mockGetQuote: mockGetQuote, __mockGetAccount: mockGetAccount } =
	(await import("@/server/providers/alpaca")) as unknown as {
		__mockGetQuote: ReturnType<typeof vi.fn>;
		__mockGetAccount: ReturnType<typeof vi.fn>;
	};

const makeAccount = (): Account => ({
	alpacaApiKey: "test-key",
	alpacaApiSecret: "test-secret",
	name: "TestModel",
	modelName: "TestModel",
	invocationCount: 1,
	id: "account-1",
	totalMinutes: 60,
	variant: "Sovereign",
});

const makePosition = (
	overrides: Partial<{
		symbol: string;
		side: "LONG" | "SHORT" | "HOLD";
		quantity: number;
		profitTarget: number | null;
		stopLoss: number | null;
		invalidationCondition: string | null;
		invalidationPrice: number | null;
		timeExit: string | null;
		cooldownUntil: string | null;
		confidence: number | null;
	}> = {},
) => ({
	symbol: overrides.symbol ?? "BTC",
	side: overrides.side ?? "LONG",
	quantity: overrides.quantity ?? 1,
	profitTarget: overrides.profitTarget ?? null,
	stopLoss: overrides.stopLoss ?? null,
	invalidationCondition: overrides.invalidationCondition ?? null,
	invalidationPrice: overrides.invalidationPrice ?? null,
	timeExit: overrides.timeExit ?? null,
	cooldownUntil: overrides.cooldownUntil ?? null,
	confidence: overrides.confidence ?? null,
});

describe("createPosition", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("can be imported", async () => {
		expect(createPosition).toBeDefined();
	});

	it("rejects trade below minimum notional size", async () => {
		// BTC at $30,000, quantity 0.001 → notional $30 < $50
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 29_990,
			ask_price: 30_010,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 0.001 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toBeDefined();
		expect(results[0].error).toContain("below the minimum");
		expect(results[0].error).toContain("$50");
	});

	it("rejects trade with notional of $49.99", async () => {
		// Price $49.99, qty 1 → notional $49.99 < $50
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 49.98,
			ask_price: 50.0,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 1 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("below the minimum");
	});

	it("allows trade at exactly $50 notional", async () => {
		// Price $50, qty 1 → notional $50 = $50 (at threshold)
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 50.0,
			ask_price: 50.0,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 1 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
	});

	it("allows trade well above $50 notional", async () => {
		// BTC at $30,000, qty 0.01 → notional $300 > $50
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 29_990,
			ask_price: 30_010,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 0.01 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
	});

	it("rejection message clearly states the threshold amount", async () => {
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 100,
			ask_price: 100,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 0.1 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toMatch(/minimum.*\$50/i);
	});

	it("skips HOLD positions without checking minimum size", async () => {
		const results = await createPosition(makeAccount(), [
			makePosition({ side: "HOLD", quantity: 0.0001 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
		expect(mockGetQuote).not.toHaveBeenCalled();
	});

	it("caps trade size to available balance when oversized", async () => {
		// BTC at $30,000, quantity 1 → notional $30,000, but cash only $10,000
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 29_990,
			ask_price: 30_010,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 1 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
		// Should be capped: ~0.333 BTC
		expect(results[0].quantity).toBeLessThan(1);
		expect(results[0].quantity).toBeGreaterThan(0);
	});

	it("sets adjustmentNote when trade size is capped", async () => {
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 29_990,
			ask_price: 30_010,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 1 }),
		]);

		expect(results[0].adjustmentNote).toBeDefined();
		expect(results[0].adjustmentNote).toContain("Trade size adjusted");
		expect(results[0].adjustmentNote).toContain("exceeds available balance");
	});

	it("does not cap trade when balance is sufficient", async () => {
		// BTC at $50, quantity 1 → notional $50, cash $10,000 — well within balance
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 50.0,
			ask_price: 50.0,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 1 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
		expect(results[0].quantity).toBe(1);
		expect(results[0].adjustmentNote).toBeUndefined();
	});

	it("throws when balance cannot cover any quantity", async () => {
		// Cash $10, price $30,000 → maxQty = 0.000333, but let's use $1 cash
		mockGetAccount.mockResolvedValueOnce({
			id: "acct-1",
			account_number: "12345",
			status: "ACTIVE",
			currency: "USD",
			cash: 0.01,
			buying_power: 0.01,
			regt_buying_power: 0.01,
			daytrading_buying_power: 0.01,
			equity: 0.01,
			last_equity: 0.01,
			long_market_value: 0,
			short_market_value: 0,
			portfolio_value: 0.01,
			pattern_day_trader: false,
			trading_blocked: false,
			transfers_blocked: false,
			account_blocked: false,
			multiplier: "1",
			shorting_enabled: false,
			maintenance_margin: 0,
			initial_margin: 0,
			daytrade_count: 0,
			created_at: "2024-01-01",
		});
		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 29_990,
			ask_price: 30_010,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		const results = await createPosition(makeAccount(), [
			makePosition({ quantity: 1 }),
		]);

		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(false);
		expect(results[0].error).toContain("Insufficient balance");
	});

	it("logs adjustment with original and adjusted sizes", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		mockGetQuote.mockResolvedValue({
			symbol: "BTC/USD",
			bid_price: 29_990,
			ask_price: 30_010,
			bid_size: 1,
			ask_size: 1,
			timestamp: new Date().toISOString(),
		});

		await createPosition(makeAccount(), [makePosition({ quantity: 1 })]);

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Trade size adjusted"),
		);
		warnSpy.mockRestore();
	});
});
