import type { SimpleOrder } from "@/lighter/generated";

export type TradingMode = "live" | "simulated";

export type OrderSide = "buy" | "sell";

export type OrderType = "market" | "limit";

export interface SimulatorLatency {
	minMs: number;
	maxMs: number;
}

export interface SimulatorSlippage {
	maxBasisPoints: number;
}

export interface SimulatorFeeConfig {
	makerBps: number;
	takerBps: number;
}

export interface ExchangeSimulatorOptions {
	initialCapital: number;
	quoteCurrency: string;
	latency: SimulatorLatency;
	slippage: SimulatorSlippage;
	fees: SimulatorFeeConfig;
	deterministicSeed?: number;
	fundingPeriodHours: number;
	fundingRefreshIntervalMs: number;
	refreshIntervalMs: number;
}

export interface MarketMetadata {
	symbol: string;
	marketId: number;
	priceDecimals: number;
	qtyDecimals: number;
	clientOrderIndex: number;
}

export interface OrderBookLevel {
	price: number;
	quantity: number;
}

export interface OrderBookSnapshot {
	symbol: string;
	bids: OrderBookLevel[];
	asks: OrderBookLevel[];
	midPrice: number;
	spread: number;
	timestamp: number;
}

export interface OrderMatchingInput {
	symbol: string;
	side: OrderSide;
	type: OrderType;
	quantity: number;
	limitPrice?: number;
	leverage?: number;
}

export interface FillDetail {
	quantity: number;
	price: number;
	maker: boolean;
	fee: number;
	slippageBps: number;
	latencyMs: number;
}

export interface OrderExecution {
	fills: FillDetail[];
	averagePrice: number;
	totalQuantity: number;
	totalFees: number;
	status: "filled" | "partial" | "rejected";
	reason?: string;
}

export interface SimulatedOrderRequest extends OrderMatchingInput {
	confidence?: number | null;
	exitPlan?: PositionExitPlan | null;
}

export interface SimulatedOrderResult extends OrderExecution {
	symbol: string;
	side: OrderSide;
	type: OrderType;
}

export interface PositionExitPlan {
	stop: number | null;
	target: number | null;
	invalidation: string | null;
}

export interface PositionSummary {
	symbol: string;
	quantity: number;
	side: "LONG" | "SHORT";
	avgEntryPrice: number;
	realizedPnl: number;
	unrealizedPnl: number;
	markPrice: number;
	margin: number;
	notional: number;
	leverage: number | null;
	exitPlan: PositionExitPlan | null;
}

export interface AccountSnapshot {
	cashBalance: number;
	availableCash: number;
	borrowedBalance: number;
	equity: number;
	marginBalance: number;
	quoteCurrency: string;
	positions: PositionSummary[];
	totalRealizedPnl: number;
	totalUnrealizedPnl: number;
	totalFundingPnl: number;
}

export interface OrderBookSource {
	totalAsks: number;
	totalBids: number;
	asks: SimpleOrder[];
	bids: SimpleOrder[];
}

export interface AccountEventPayload {
	accountId: string;
	snapshot: AccountSnapshot;
}

export interface TradeEventPayload {
	accountId: string;
	symbol: string;
	result: SimulatedOrderResult;
	timestamp: number;
	realizedPnl?: number;
	notional?: number;
	leverage?: number | null;
	confidence?: number | null;
	direction?: "LONG" | "SHORT";
	completed?: boolean;
	accountValue?: number;
}

export type MarketEvent =
	| { type: "book"; payload: OrderBookSnapshot }
	| { type: "trade"; payload: TradeEventPayload }
	| { type: "account"; payload: AccountEventPayload };
