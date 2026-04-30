import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/server/features/trading/contracts/accounts";

// Mock the provider module before importing createPosition
vi.mock("@/server/providers/alpaca", () => {
	const mockGetQuote = vi.fn();
	return {
		getTradingProvider: vi.fn(() => ({
			createOrder: vi.fn().mockResolvedValue({
				id: "order-1",
				filled_avg_price: "100.00",
				filled_qty: "1",
			}),
			getOrder: vi.fn().mockResolvedValue({
				id: "order-1",
				filled_avg_price: "100.00",
				filled_qty: "1",
			}),
		})),
		getMarketDataProvider: vi.fn(() => ({
			getQuote: mockGetQuote,
		})),
		__mockGetQuote: mockGetQuote,
	};
});

vi.mock("@/server/db/ordersRepository.server", () => ({
	createOrder: vi.fn().mockResolvedValue({
		id: "db-order-1",
		quantity: "1",
		entryPrice: "100.00",
		side: "LONG",
	}),
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
const { __mockGetQuote: mockGetQuote } = (await import(
	"@/server/providers/alpaca"
)) as unknown as {
	__mockGetQuote: ReturnType<typeof vi.fn>;
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
});
