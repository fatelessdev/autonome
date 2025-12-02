//@ts-nocheck

import { orderApi } from "@/server/integrations/lighter";
import { ToolCallType } from "@/server/db/tradingRepository";
import {
	createInvocationMutation,
	createToolCallMutation,
} from "@/server/db/tradingRepository.server";
import {
	closeOrder,
	getOpenOrderBySymbol,
} from "@/server/db/ordersRepository.server";
import { AccountState } from "@/server/features/simulator/accountState";
import { MarketState } from "@/server/features/simulator/market";
import {
	matchOrder,
	type RandomSource,
} from "@/server/features/simulator/orderMatching";
import type {
	AccountSnapshot,
	ExchangeSimulatorOptions,
	MarketEvent,
	MarketMetadata,
	OrderSide,
	PositionExitPlan,
	PositionSummary,
	SimulatedOrderRequest,
	SimulatedOrderResult,
} from "@/server/features/simulator/types";
import { emitAllDataChanged } from "@/server/events/workflowEvents";
import { MARKETS } from "@/shared/markets/marketMetadata";

type SimulatorEventType = MarketEvent["type"];

class SimpleEmitter {
	private readonly listeners = new Map<
		SimulatorEventType,
		Set<(event: MarketEvent) => void>
	>();

	on(event: SimulatorEventType, listener: (event: MarketEvent) => void) {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
	}

	off(event: SimulatorEventType, listener: (event: MarketEvent) => void) {
		const listeners = this.listeners.get(event);
		listeners?.delete(listener);
		if (listeners && listeners.size === 0) {
			this.listeners.delete(event);
		}
	}

	emit(event: SimulatorEventType, payload: MarketEvent) {
		const listeners = this.listeners.get(event);
		if (!listeners) return;
		for (const listener of listeners) {
			listener(payload);
		}
	}
}

class MathRandomSource implements RandomSource {
	next(): number {
		return Math.random();
	}
}

function buildMarketMetadata(): MarketMetadata[] {
	return Object.entries(MARKETS).map(([symbol, config]) => ({
		symbol,
		marketId: config.marketId,
		priceDecimals: config.priceDecimals,
		qtyDecimals: config.qtyDecimals,
		clientOrderIndex: config.clientOrderIndex,
	}));
}

function normalizeSymbol(symbol: string): string {
	if (!symbol) return symbol;
	const upper = symbol.toUpperCase();
	if (upper.endsWith("USDT")) {
		return upper.replace("USDT", "");
	}
	return upper;
}

declare global {
	// eslint-disable-next-line no-var
	var __exchangeSimulator: Promise<ExchangeSimulator> | undefined;
}

export class ExchangeSimulator {
	static async bootstrap(
		options?: Partial<ExchangeSimulatorOptions>,
	): Promise<ExchangeSimulator> {
		if (!globalThis.__exchangeSimulator) {
			globalThis.__exchangeSimulator = ExchangeSimulator.create(options);
		}
		return globalThis.__exchangeSimulator;
	}

	private static async create(
		options: ExchangeSimulatorOptions,
	): Promise<ExchangeSimulator> {
		const simulator = new ExchangeSimulator(options);
		await simulator.initialise();
		return simulator;
	}

	private readonly options: ExchangeSimulatorOptions;
	private readonly accounts = new Map<string, AccountState>();
	private readonly markets = new Map<string, MarketState>();
	private readonly emitter = new SimpleEmitter();
	private readonly rng: RandomSource;
	private readonly pendingAutoCloses = new Set<string>();
	private refreshHandle?: NodeJS.Timeout;

	private constructor(options: ExchangeSimulatorOptions) {
		this.options = options;
		this.rng = new MathRandomSource();
	}

	private getOrCreateAccount(accountId: string): AccountState {
		let account = this.accounts.get(accountId);
		if (!account) {
			account = new AccountState(this.options);
			this.accounts.set(accountId, account);
		}
		return account;
	}

	private emitAccountSnapshot(
		accountId: string,
		snapshotOverride?: AccountSnapshot,
	) {
		const account = this.accounts.get(accountId);
		if (!account) {
			return;
		}

		const snapshot = snapshotOverride ?? account.getSnapshot();
		this.emitter.emit("account", {
			type: "account",
			payload: { accountId, snapshot },
		} as MarketEvent);
	}

	resetAccount(accountId: string): AccountSnapshot {
		const normalized =
			accountId.trim().length > 0 ? accountId.trim() : "default";

		const pendingPrefix = `${normalized}:`;
		for (const key of Array.from(this.pendingAutoCloses)) {
			if (key.startsWith(pendingPrefix)) {
				this.pendingAutoCloses.delete(key);
			}
		}

		const account = new AccountState(this.options);
		this.accounts.set(normalized, account);
		const snapshot = account.getSnapshot();
		this.emitAccountSnapshot(normalized, snapshot);
		return snapshot;
	}

	private async initialise() {
		for (const metadata of buildMarketMetadata()) {
			const market = new MarketState(metadata, orderApi);
			try {
				await market.refresh();
			} catch (error) {
				console.error(
					`[Simulator] Failed to initialize market ${metadata.symbol}:`,
					error instanceof Error ? error.message : error,
				);
				// Continue with other markets - we'll use stale/zero prices for this one
			}
			this.markets.set(metadata.symbol, market);
		}

		// Restore open positions from database
		await this.restorePositionsFromDb();

		this.startPolling();
	}

	/**
	 * Restore open positions from the Orders table into simulator state.
	 * This ensures auto-close triggers work even after server restarts.
	 */
	private async restorePositionsFromDb() {
		try {
			const { getAllOpenOrders } = await import(
				"@/server/db/ordersRepository.server"
			);
			const openOrders = await getAllOpenOrders();

			if (openOrders.length === 0) {
				return;
			}

			for (const order of openOrders) {
				const account = this.getOrCreateAccount(order.modelId);
				const symbol = normalizeSymbol(order.symbol);
				const market = this.markets.get(symbol);
				const markPrice = market?.getMidPrice() ?? parseFloat(order.entryPrice);

				// Restore the position via a synthetic execution
				const quantity = parseFloat(order.quantity);
				const entryPrice = parseFloat(order.entryPrice);
				const leverage = order.leverage ? parseFloat(order.leverage) : 1;
				const side = order.side === "LONG" ? "buy" : "sell";

				// Apply execution to create the position in memory
				account.applyExecution(
					symbol,
					side,
					{
						fills: [{ quantity, price: entryPrice }],
						averagePrice: entryPrice,
						totalQuantity: quantity,
						status: "filled",
					},
					leverage,
				);

				// Set exit plan if present
				if (order.exitPlan) {
					account.setExitPlan(symbol, order.exitPlan);
				}

				// Update mark price
				account.updateMarkPrice(symbol, markPrice);
			}

		} catch (error) {
			console.error("[Simulator] Failed to restore positions from DB:", error);
		}
	}

	private startPolling() {
		if (this.refreshHandle) return;
		this.refreshHandle = setInterval(() => {
			void this.refreshAll();
		}, this.options.refreshIntervalMs);
	}

	private async refreshAll() {
		for (const [symbol, market] of this.markets) {
			try {
				const snapshot = await market.refresh();
				for (const account of this.accounts.values()) {
					account.updateMarkPrice(symbol, snapshot.midPrice);
				}
			} catch (error) {
				// Log concise message for network errors (they're common/expected during connectivity issues)
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[Simulator] Market refresh failed for ${symbol}: ${message}`);
			}
		}

		const autoCloseQueue: Array<{
			accountId: string;
			symbol: string;
			trigger: "STOP" | "TARGET";
		}> = [];

		for (const [accountId, account] of this.accounts.entries()) {
			const triggers = account.collectExitPlanTriggers();
			for (const trigger of triggers) {
				const key = `${accountId}:${trigger.symbol}`;
				if (this.pendingAutoCloses.has(key)) {
					continue;
				}
				this.pendingAutoCloses.add(key);
				autoCloseQueue.push({
					accountId,
					symbol: trigger.symbol,
					trigger: trigger.trigger,
				});
			}
			this.emitAccountSnapshot(accountId);
		}

		for (const request of autoCloseQueue) {
			try {
				const accountSnapshot = this.accounts.get(request.accountId);
				const positionBefore = accountSnapshot
					?.getOpenPositions()
					.find(
						(pos) =>
							normalizeSymbol(pos.symbol) === normalizeSymbol(request.symbol),
					);

				const outcomes = await this.closePositions(
					[request.symbol],
					request.accountId,
					{
						autoTrigger: request.trigger,
					},
				);
				const outcome =
					outcomes[request.symbol] ?? outcomes[normalizeSymbol(request.symbol)];

				if (outcome?.status === "rejected") {
					console.warn(
						`[Simulator] Auto-close rejected for ${request.symbol}: ${outcome.reason ?? "unknown"}`,
					);
					const account = this.accounts.get(request.accountId);
					account?.clearPendingExit(normalizeSymbol(request.symbol));
				} else if (outcome && positionBefore) {
					// Calculate P&L
					const isLong = positionBefore.side === "LONG";
					const pnl = isLong
						? (outcome.averagePrice - positionBefore.avgEntryPrice) *
							positionBefore.quantity
						: (positionBefore.avgEntryPrice - outcome.averagePrice) *
							positionBefore.quantity;

					// Update order in Orders table (primary source of truth)
					try {
						const normalizedSymbol = normalizeSymbol(request.symbol);
						const dbOrder = await getOpenOrderBySymbol(
							request.accountId,
							normalizedSymbol,
						);
						if (dbOrder) {
							await closeOrder({
								orderId: dbOrder.id,
								exitPrice: outcome.averagePrice.toString(),
								realizedPnl: pnl.toString(),
								closeTrigger: request.trigger,
							});
						}
					} catch (orderDbError) {
						console.error(
							`[Simulator] Failed to update Orders table:`,
							orderDbError,
						);
					}

					// Record the auto-closed position in the ToolCalls table (for audit/history)
					try {
						const invocation = await createInvocationMutation(
							request.accountId,
						);
						const closedPosition = {
							symbol: request.symbol,
							side: positionBefore.side,
							quantity: positionBefore.quantity,
							entryPrice: positionBefore.avgEntryPrice,
							exitPrice: outcome.averagePrice,
							markPrice: outcome.averagePrice,
							realizedPnl: pnl,
							unrealizedPnl: 0,
							netPnl: pnl,
							closedAt: new Date().toISOString(),
						};

						await createToolCallMutation({
							invocationId: invocation.id,
							type: ToolCallType.CLOSE_POSITION,
							metadata: JSON.stringify({
								symbols: [request.symbol],
								closedPositions: [closedPosition],
								autoTrigger: request.trigger,
							}),
						});
					} catch (dbError) {
						console.error(
							`[Simulator] Failed to record auto-close in ToolCalls:`,
							dbError,
						);
					}

					await emitAllDataChanged(request.accountId);
				}
			} finally {
				this.pendingAutoCloses.delete(`${request.accountId}:${request.symbol}`);
			}
		}
	}

	on(event: SimulatorEventType, listener: (event: MarketEvent) => void) {
		this.emitter.on(event, listener);
	}

	off(event: SimulatorEventType, listener: (event: MarketEvent) => void) {
		this.emitter.off(event, listener);
	}

	getAccountSnapshot(accountId: string): AccountSnapshot {
		return this.getOrCreateAccount(accountId).getSnapshot();
	}

	getOpenPositions(accountId: string): PositionSummary[] {
		return this.getOrCreateAccount(accountId).getOpenPositions();
	}

	getOrderBook(symbol: string) {
		const normalized = normalizeSymbol(symbol);
		const market = this.markets.get(normalized);
		if (!market) {
			throw new Error(`Unknown market: ${symbol}`);
		}
		return market.getSnapshot();
	}

	async placeOrder(
		request: SimulatedOrderRequest, accountId: string, p0: { skipValidation: boolean; },
	): Promise<SimulatedOrderResult> {
		const symbol = normalizeSymbol(request.symbol);
		const market = this.markets.get(symbol);
		if (!market) {
			return {
				...this.rejected("unknown symbol"),
				symbol,
				side: request.side,
				type: request.type,
			};
		}

		const book = market.getSnapshot();
		const execution = matchOrder(book, request, this.options, this.rng);
		const account = this.getOrCreateAccount(accountId);
		const snapshotBefore = account.getSnapshot();
		const beforePosition = snapshotBefore.positions.find(
			(pos) => normalizeSymbol(pos.symbol) === symbol,
		);

		if (execution.status === "rejected" || execution.totalQuantity === 0) {
			return { ...execution, symbol, side: request.side, type: request.type };
		}

		if (
			!account.hasSufficientCash(
				symbol,
				request.side,
				execution,
				request.leverage,
			)
		) {
			return {
				fills: [],
				averagePrice: 0,
				totalQuantity: 0,
				totalFees: 0,
				status: "rejected",
				reason: "insufficient available cash",
				symbol,
				side: request.side,
				type: request.type,
			};
		}

		account.applyExecution(symbol, request.side, execution, request.leverage);
		if (Object.hasOwn(request, "exitPlan")) {
			account.setExitPlan(symbol, request.exitPlan ?? null);
		}
		account.updateMarkPrice(symbol, market.getMidPrice());

		const snapshotAfter = account.getSnapshot();
		const afterPosition = snapshotAfter.positions.find(
			(pos) => normalizeSymbol(pos.symbol) === symbol,
		);
		const realizedDelta =
			snapshotAfter.totalRealizedPnl - snapshotBefore.totalRealizedPnl;
		const leverageApplied =
			beforePosition?.leverage ??
			afterPosition?.leverage ??
			(typeof request.leverage === "number" ? request.leverage : null);
		const completed = Boolean(
			beforePosition && (!afterPosition || afterPosition.quantity === 0),
		);
		const direction =
			beforePosition?.side ?? (request.side === "buy" ? "LONG" : "SHORT");
		const notional = Math.abs(execution.totalQuantity * execution.averagePrice);
		const confidence =
			typeof request.confidence === "number" &&
				Number.isFinite(request.confidence)
				? request.confidence
				: null;

		const result: SimulatedOrderResult = {
			...execution,
			symbol,
			side: request.side,
			type: request.type,
		};

		this.emitter.emit("trade", {
			type: "trade",
			payload: {
				accountId,
				symbol,
				result,
				timestamp: Date.now(),
				realizedPnl: realizedDelta,
				notional,
				leverage: leverageApplied ?? null,
				confidence,
				direction,
				completed,
				accountValue: snapshotAfter.equity,
			},
		} as MarketEvent);
		this.emitAccountSnapshot(accountId, snapshotAfter);

		return result;
	}

	async closePositions(
		symbols: string[],
		accountId: string,
		options?: { autoTrigger?: "STOP" | "TARGET" },
	): Promise<Record<string, SimulatedOrderResult>> {
		const outcomes: Record<string, SimulatedOrderResult> = {};

		for (const symbolRaw of symbols) {
			const symbol = normalizeSymbol(symbolRaw);
			const position = this.getOpenPositions(accountId).find(
				(pos) => normalizeSymbol(pos.symbol) === symbol,
			);
			if (!position || position.quantity === 0) {
				outcomes[symbolRaw] = {
					...this.rejected("no open position"),
					symbol,
					side: "sell",
					type: "market",
				};
				continue;
			}

			const side: OrderSide = position.side === "LONG" ? "sell" : "buy";
			const quantity = position.quantity;
			const result = await this.placeOrder(
				{ symbol, side, quantity, type: "market" },
				accountId,
			);
			outcomes[symbolRaw] = result;
			const account = this.accounts.get(accountId);
			account?.clearPendingExit(symbol);
		}

		return outcomes;
	}

	private rejected(reason: string): SimulatedOrderResult {
		return {
			fills: [],
			averagePrice: 0,
			totalQuantity: 0,
			totalFees: 0,
			status: "rejected",
			reason,
			symbol: "",
			side: "buy",
			type: "market",
		};
	}

	setExitPlan(
		accountId: string,
		symbol: string,
		exitPlan: PositionExitPlan | null,
	) {
		const normalized = normalizeSymbol(symbol);
		const account = this.getOrCreateAccount(accountId);
		account.setExitPlan(normalized, exitPlan);
	}
}
