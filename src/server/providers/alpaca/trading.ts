/**
 * Alpaca Trading Provider
 *
 * Implements BrokerProvider using Alpaca's Trading API v2.
 * Handles string-to-number parsing since Alpaca returns numeric values as strings.
 * Ported from MAHORAGA/src/providers/alpaca/trading.ts.
 */

import type {
	Asset,
	BrokerAccount,
	BrokerOrder,
	BrokerPosition,
	BrokerProvider,
	ListOrdersParams,
	MarketClock,
	OrderParams,
	PortfolioHistory,
	PortfolioHistoryParams,
} from "../types";
import { type AlpacaClient, AlpacaError } from "./client";

// ==================== Raw Alpaca Response Types ====================
// Alpaca returns numeric values as strings — these raw types reflect that.

interface AlpacaRawAccount {
	id: string;
	account_number: string;
	status: string;
	currency: string;
	cash: string;
	buying_power: string;
	regt_buying_power: string;
	daytrading_buying_power: string;
	equity: string;
	last_equity: string;
	long_market_value: string;
	short_market_value: string;
	portfolio_value: string;
	pattern_day_trader: boolean;
	trading_blocked: boolean;
	transfers_blocked: boolean;
	account_blocked: boolean;
	multiplier: string;
	shorting_enabled: boolean;
	maintenance_margin: string;
	initial_margin: string;
	daytrade_count: number;
	created_at: string;
}

interface AlpacaRawPosition {
	asset_id: string;
	symbol: string;
	exchange: string;
	asset_class: string;
	avg_entry_price: string;
	qty: string;
	side: string;
	market_value: string;
	cost_basis: string;
	unrealized_pl: string;
	unrealized_plpc: string;
	unrealized_intraday_pl: string;
	unrealized_intraday_plpc: string;
	current_price: string;
	lastday_price: string;
	change_today: string;
}

interface AlpacaRawClock {
	timestamp: string;
	is_open: boolean;
	next_open: string;
	next_close: string;
}

// ==================== Parsers ====================

function parseAccount(raw: AlpacaRawAccount): BrokerAccount {
	return {
		id: raw.id,
		account_number: raw.account_number,
		status: raw.status,
		currency: raw.currency,
		cash: Number.parseFloat(raw.cash),
		buying_power: Number.parseFloat(raw.buying_power),
		regt_buying_power: Number.parseFloat(raw.regt_buying_power),
		daytrading_buying_power: Number.parseFloat(raw.daytrading_buying_power),
		equity: Number.parseFloat(raw.equity),
		last_equity: Number.parseFloat(raw.last_equity),
		long_market_value: Number.parseFloat(raw.long_market_value),
		short_market_value: Number.parseFloat(raw.short_market_value),
		portfolio_value: Number.parseFloat(raw.portfolio_value),
		pattern_day_trader: raw.pattern_day_trader,
		trading_blocked: raw.trading_blocked,
		transfers_blocked: raw.transfers_blocked,
		account_blocked: raw.account_blocked,
		multiplier: raw.multiplier,
		shorting_enabled: raw.shorting_enabled,
		maintenance_margin: Number.parseFloat(raw.maintenance_margin),
		initial_margin: Number.parseFloat(raw.initial_margin),
		daytrade_count: raw.daytrade_count,
		created_at: raw.created_at,
	};
}

function parsePosition(raw: AlpacaRawPosition): BrokerPosition {
	return {
		asset_id: raw.asset_id,
		symbol: raw.symbol,
		exchange: raw.exchange,
		asset_class: raw.asset_class,
		avg_entry_price: Number.parseFloat(raw.avg_entry_price),
		qty: Number.parseFloat(raw.qty),
		side: raw.side as "long" | "short",
		market_value: Number.parseFloat(raw.market_value),
		cost_basis: Number.parseFloat(raw.cost_basis),
		unrealized_pl: Number.parseFloat(raw.unrealized_pl),
		unrealized_plpc: Number.parseFloat(raw.unrealized_plpc),
		unrealized_intraday_pl: Number.parseFloat(raw.unrealized_intraday_pl),
		unrealized_intraday_plpc: Number.parseFloat(
			raw.unrealized_intraday_plpc,
		),
		current_price: Number.parseFloat(raw.current_price),
		lastday_price: Number.parseFloat(raw.lastday_price),
		change_today: Number.parseFloat(raw.change_today),
	};
}

// ==================== Trading Provider ====================

export class AlpacaTradingProvider implements BrokerProvider {
	constructor(private client: AlpacaClient) {}

	async getAccount(): Promise<BrokerAccount> {
		const raw = await this.client.tradingRequest<AlpacaRawAccount>(
			"GET",
			"/v2/account",
		);
		return parseAccount(raw);
	}

	async getPositions(): Promise<BrokerPosition[]> {
		const raw = await this.client.tradingRequest<AlpacaRawPosition[]>(
			"GET",
			"/v2/positions",
		);
		return raw.map(parsePosition);
	}

	async getPosition(symbol: string): Promise<BrokerPosition | null> {
		try {
			const raw = await this.client.tradingRequest<AlpacaRawPosition>(
				"GET",
				`/v2/positions/${encodeURIComponent(symbol)}`,
			);
			return parsePosition(raw);
		} catch (error) {
			if (error instanceof AlpacaError && error.code === "NOT_FOUND") {
				return null;
			}
			throw error;
		}
	}

	async closePosition(
		symbol: string,
		qty?: number,
		percentage?: number,
	): Promise<BrokerOrder> {
		let path = `/v2/positions/${encodeURIComponent(symbol)}`;
		const params = new URLSearchParams();

		if (qty !== undefined) {
			params.set("qty", String(qty));
		} else if (percentage !== undefined) {
			params.set("percentage", String(percentage));
		}

		const queryString = params.toString();
		if (queryString) {
			path += `?${queryString}`;
		}

		return this.client.tradingRequest<BrokerOrder>("DELETE", path);
	}

	async createOrder(params: OrderParams): Promise<BrokerOrder> {
		const body: Record<string, unknown> = {
			symbol: params.symbol,
			side: params.side,
			type: params.type,
			time_in_force: params.time_in_force,
		};

		if (params.qty !== undefined) body.qty = String(params.qty);
		if (params.notional !== undefined)
			body.notional = String(params.notional);
		if (params.limit_price !== undefined)
			body.limit_price = String(params.limit_price);
		if (params.stop_price !== undefined)
			body.stop_price = String(params.stop_price);
		if (params.trail_price !== undefined)
			body.trail_price = String(params.trail_price);
		if (params.trail_percent !== undefined)
			body.trail_percent = String(params.trail_percent);
		if (params.extended_hours !== undefined)
			body.extended_hours = params.extended_hours;
		if (params.client_order_id !== undefined)
			body.client_order_id = params.client_order_id;
		if (params.order_class !== undefined)
			body.order_class = params.order_class;
		if (params.take_profit !== undefined) {
			body.take_profit = {
				limit_price: String(params.take_profit.limit_price),
			};
		}
		if (params.stop_loss !== undefined) {
			body.stop_loss = {
				stop_price: String(params.stop_loss.stop_price),
				...(params.stop_loss.limit_price !== undefined && {
					limit_price: String(params.stop_loss.limit_price),
				}),
			};
		}

		return this.client.tradingRequest<BrokerOrder>(
			"POST",
			"/v2/orders",
			body,
		);
	}

	async getOrder(orderId: string): Promise<BrokerOrder> {
		return this.client.tradingRequest<BrokerOrder>(
			"GET",
			`/v2/orders/${encodeURIComponent(orderId)}`,
		);
	}

	async listOrders(params?: ListOrdersParams): Promise<BrokerOrder[]> {
		let path = "/v2/orders";

		if (params) {
			const searchParams = new URLSearchParams();
			if (params.status) searchParams.set("status", params.status);
			if (params.limit) searchParams.set("limit", String(params.limit));
			if (params.after) searchParams.set("after", params.after);
			if (params.until) searchParams.set("until", params.until);
			if (params.direction)
				searchParams.set("direction", params.direction);
			if (params.nested !== undefined)
				searchParams.set("nested", String(params.nested));
			if (params.symbols?.length)
				searchParams.set("symbols", params.symbols.join(","));

			const queryString = searchParams.toString();
			if (queryString) {
				path += `?${queryString}`;
			}
		}

		return this.client.tradingRequest<BrokerOrder[]>("GET", path);
	}

	async cancelOrder(orderId: string): Promise<void> {
		await this.client.tradingRequest<void>(
			"DELETE",
			`/v2/orders/${encodeURIComponent(orderId)}`,
		);
	}

	async cancelAllOrders(): Promise<void> {
		await this.client.tradingRequest<void>("DELETE", "/v2/orders");
	}

	async getClock(): Promise<MarketClock> {
		const raw = await this.client.tradingRequest<AlpacaRawClock>(
			"GET",
			"/v2/clock",
		);
		return {
			timestamp: raw.timestamp,
			is_open: raw.is_open,
			next_open: raw.next_open,
			next_close: raw.next_close,
		};
	}

	async getAsset(symbol: string): Promise<Asset | null> {
		try {
			return await this.client.tradingRequest<Asset>(
				"GET",
				`/v2/assets/${encodeURIComponent(symbol)}`,
			);
		} catch (error) {
			if (error instanceof AlpacaError && error.code === "NOT_FOUND") {
				return null;
			}
			throw error;
		}
	}

	async getPortfolioHistory(
		params?: PortfolioHistoryParams,
	): Promise<PortfolioHistory> {
		let path = "/v2/account/portfolio/history";

		if (params) {
			const searchParams = new URLSearchParams();
			if (params.period) searchParams.set("period", params.period);
			if (params.timeframe)
				searchParams.set("timeframe", params.timeframe);
			if (params.intraday_reporting)
				searchParams.set(
					"intraday_reporting",
					params.intraday_reporting,
				);
			if (params.start) searchParams.set("start", params.start);
			if (params.end) searchParams.set("end", params.end);
			if (params.pnl_reset)
				searchParams.set("pnl_reset", params.pnl_reset);

			const queryString = searchParams.toString();
			if (queryString) {
				path += `?${queryString}`;
			}
		}

		return this.client.tradingRequest<PortfolioHistory>("GET", path);
	}
}
