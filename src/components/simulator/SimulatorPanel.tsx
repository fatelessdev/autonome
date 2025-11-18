import NumberFlow from "@number-flow/react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";
import useSimStream from "./useSimStream";
import {
	type MarketEvent,
	type TradeEventPayload,
} from "@/server/features/simulator/types";
import { orpc } from "@/server/orpc/client";

const SYMBOLS = ["BTC", "ETH", "SOL"] as const;
const DEFAULT_ACCOUNT_ID = "demo";

type OrderBookLevel = {
	price: number;
	quantity: number;
};

type OrderBookSnapshot = {
	symbol: string;
	bids: OrderBookLevel[];
	asks: OrderBookLevel[];
	midPrice: number;
	spread: number;
	timestamp: number;
};

type AccountPosition = {
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number;
	avgEntryPrice: number;
	realizedPnl: number;
	unrealizedPnl: number;
	markPrice: number;
};

type AccountOption = {
	id: string;
	label: string;
};

type AccountSnapshot = {
	cashBalance: number;
	availableCash?: number;
	borrowedBalance?: number;
	equity: number;
	marginBalance: number;
	quoteCurrency: string;
	positions: AccountPosition[];
	totalRealizedPnl: number;
	totalUnrealizedPnl: number;
};

type CompletedTrade = {
	id: string;
	symbol: string;
	direction: "LONG" | "SHORT";
	notional: number;
	realizedPnl: number;
	leverage: number | null;
	confidence: number | null;
	timestamp: number;
};

const normalizeSymbol = (value: string) =>
	value.toUpperCase().replace(/USDT$/i, "");

const numberFormatter = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

function formatUsd(value: number | null | undefined) {
	if (value === undefined || value === null || !Number.isFinite(value)) {
		return "—";
	}
	return `$${numberFormatter.format(value)}`;
}

function average(values: number[]): number | null {
	if (!values.length) return null;
	const sum = values.reduce((acc, value) => acc + value, 0);
	return sum / values.length;
}

function median(values: number[]): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}
	return sorted[mid];
}

function normalizeConfidenceRatio(
	value: number | null | undefined,
): number | null {
	if (value === null || value === undefined) return null;
	if (!Number.isFinite(value)) return null;
	if (value <= 0) return null;
	return value > 1 ? value / 100 : value;
}

export default function SimulatorPanel() {
	const [accountId, setAccountId] = useState<string>(DEFAULT_ACCOUNT_ID);
	const [accountOptions, setAccountOptions] = useState<AccountOption[]>([
		{ id: DEFAULT_ACCOUNT_ID, label: "Demo account" },
	]);
	const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>(SYMBOLS[0]);
	const [book, setBook] = useState<OrderBookSnapshot | null>(null);
	const [account, setAccount] = useState<AccountSnapshot | null>(null);
	const [completedTrades, setCompletedTrades] = useState<CompletedTrade[]>([]);
	const [errors, setErrors] = useState<string[]>([]);
	const [isResetting, setIsResetting] = useState(false);
	const accountSelectId = useId();

	const normalizedSymbol = useMemo(() => normalizeSymbol(symbol), [symbol]);

	const pushError = useCallback((scope: string, message: string) => {
		setErrors((prev) => {
			const filtered = prev.filter((entry) => !entry.startsWith(`${scope}:`));
			return [`${scope}: ${message}`, ...filtered].slice(0, 6);
		});
	}, []);

	const clearError = useCallback((scope: string) => {
		setErrors((prev) => prev.filter((entry) => !entry.startsWith(`${scope}:`)));
	}, []);

	const fetchBook = useCallback(
		async (targetSymbol: string) => {
			try {
				const data = await orpc.simulator.getOrderBook.call({
					symbol: targetSymbol,
				});
				const snapshot = {
					...data.orderBook,
					midPrice: 0,
					spread: 0,
					timestamp: Date.now()
				} as OrderBookSnapshot;
				setBook(snapshot);
				clearError("orderbook");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				pushError("orderbook", message);
				setBook(null);
			}
		},
		[clearError, pushError],
	);

	const fetchAccount = useCallback(
		async (targetAccountId: string) => {
			try {
				const data = await orpc.simulator.getAccount.call({
					accountId: targetAccountId,
				});
				setAccount(data.account as AccountSnapshot);
				clearError("account");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				pushError("account", message);
				setAccount(null);
			}
		},
		[clearError, pushError],
	);

	const resetAccount = useCallback(
		async (targetAccountId: string) => {
			if (!targetAccountId) return;
			setIsResetting(true);
			try {
				const data = await orpc.simulator.resetAccount.call({
					accountId: targetAccountId,
				});
				setAccount(data.account as AccountSnapshot);
				if (targetAccountId === accountId) {
					setCompletedTrades([]);
				}
				clearError("account");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				pushError("account", message);
			} finally {
				setIsResetting(false);
			}
		},
		[accountId, clearError, pushError],
	);

	// Fetch orderbook on mount and when symbol changes
	useEffect(() => {
		void fetchBook(symbol);
	}, [fetchBook, symbol]);

	// Fetch account on mount and when accountId changes
	useEffect(() => {
		void fetchAccount(accountId);
	}, [accountId, fetchAccount]);

	// Auto-refresh orderbook every 10 seconds
	useEffect(() => {
		const interval = setInterval(() => {
			void fetchBook(symbol);
		}, 10_000);
		return () => clearInterval(interval);
	}, [symbol, fetchBook]);

	// Auto-refresh account every 10 seconds
	useEffect(() => {
		const interval = setInterval(() => {
			void fetchAccount(accountId);
		}, 10_000);
		return () => clearInterval(interval);
	}, [accountId, fetchAccount]);

	useEffect(() => {
		let cancelled = false;

		const fetchCompletedTrades = async () => {
			setCompletedTrades([]);

			if (!accountId || accountId === DEFAULT_ACCOUNT_ID) {
				clearError("completed");
				return;
			}

			try {
				const data = await orpc.simulator.getCompletedTrades.call({
					accountId: accountId,
				});
				if (cancelled) return;

				const trades = Array.isArray(data.trades)
					? (data.trades as Array<Record<string, unknown>>)
							.map((entry) => {
								const symbol =
									typeof entry.symbol === "string" ? entry.symbol : null;
								if (!symbol) {
									return null;
								}

								const direction =
									typeof entry.direction === "string" &&
									entry.direction.toUpperCase() === "SHORT"
										? "SHORT"
										: "LONG";

								const notional =
									typeof entry.notional === "number" &&
									Number.isFinite(entry.notional)
										? Math.abs(entry.notional)
										: null;
								const realizedPnl =
									typeof entry.realizedPnl === "number" &&
									Number.isFinite(entry.realizedPnl)
										? entry.realizedPnl
										: 0;
								const leverage =
									typeof entry.leverage === "number" &&
									Number.isFinite(entry.leverage)
										? entry.leverage
										: null;
								const confidence =
									typeof entry.confidence === "number" &&
									Number.isFinite(entry.confidence)
										? entry.confidence
										: null;
								const parsedClosedAt =
									typeof entry.closedAt === "string"
										? Date.parse(entry.closedAt)
										: NaN;
								const timestamp = Number.isFinite(parsedClosedAt)
									? parsedClosedAt
									: Date.now();

								const id =
									typeof entry.id === "string"
										? entry.id
										: `${symbol}-${timestamp}`;

								return {
									id,
									symbol,
									direction,
									notional: notional ?? 0,
									realizedPnl,
									leverage,
									confidence,
									timestamp,
								} satisfies CompletedTrade;
							})
							.filter((value): value is CompletedTrade => value !== null)
					: [];

				setCompletedTrades(trades);
				clearError("completed");
			} catch (error) {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : String(error);
				pushError("completed", message);
			}
		};

		void fetchCompletedTrades();

		return () => {
			cancelled = true;
		};
	}, [accountId, clearError, pushError]);

	useEffect(() => {
		let cancelled = false;

		const loadAccounts = async () => {
			try {
				const data = await orpc.models.getModels.call({});
				if (cancelled) return;

				const fetched = Array.isArray(data.models)
					? (data.models as Array<{ id: string; name?: string | null }>).map(
							(model) => ({
								id: model.id,
								label:
									model.name && model.name.trim().length > 0
										? model.name
										: model.id,
							}),
						)
					: [];

				const fallback = { id: DEFAULT_ACCOUNT_ID, label: "Demo account" };
				const options = fetched.length > 0 ? [...fetched] : [fallback];
				if (!options.some((option) => option.id === fallback.id)) {
					options.push(fallback);
				}

				setAccountOptions(options);
				clearError("models");

				setAccountId((previous) => {
					if (previous === DEFAULT_ACCOUNT_ID && fetched.length > 0) {
						return fetched[0]?.id ?? previous;
					}
					if (!options.some((option) => option.id === previous)) {
						return options[0]?.id ?? DEFAULT_ACCOUNT_ID;
					}
					return previous;
				});
			} catch (error) {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : String(error);
				pushError("models", message);
				setAccountOptions((prev) =>
					prev.length > 0
						? prev
						: [{ id: DEFAULT_ACCOUNT_ID, label: "Demo account" }],
				);
			}
		};

		void loadAccounts();

		return () => {
			cancelled = true;
		};
	}, [clearError, pushError]);

	const handleStreamEvent = useCallback(
		(event: MarketEvent) => {
			if (event.type === "book") {
				const snapshot = event.payload as OrderBookSnapshot;
				if (normalizeSymbol(snapshot.symbol) === normalizedSymbol) {
					setBook(snapshot);
				}
			}

			if (event.type === "account") {
				const payload = event.payload as { snapshot?: AccountSnapshot } | null;
				if (payload?.snapshot) {
					setAccount(payload.snapshot);
				}
			}
			if (event.type === "trade") {
				const payload = event.payload as TradeEventPayload;
				if (!payload?.completed) {
					return;
				}

				const notional =
					typeof payload.notional === "number" &&
					Number.isFinite(payload.notional)
						? Math.abs(payload.notional)
						: null;
				const realized =
					typeof payload.realizedPnl === "number" &&
					Number.isFinite(payload.realizedPnl)
						? payload.realizedPnl
						: 0;
				const leverage =
					typeof payload.leverage === "number" &&
					Number.isFinite(payload.leverage)
						? payload.leverage
						: null;
				const confidence =
					typeof payload.confidence === "number" &&
					Number.isFinite(payload.confidence)
						? payload.confidence
						: null;
				const direction = payload.direction === "SHORT" ? "SHORT" : "LONG";
				const entry: CompletedTrade = {
					id: `${payload.timestamp}-${payload.symbol}-${Math.random().toString(36).slice(2, 8)}`,
					symbol: payload.symbol,
					direction,
					notional: notional ?? 0,
					realizedPnl: realized,
					leverage,
					confidence,
					timestamp: payload.timestamp,
				};

				setCompletedTrades((prev) => {
					if (
						prev.some(
							(item) =>
								item.symbol === entry.symbol &&
								item.timestamp === entry.timestamp,
						)
					) {
						return prev;
					}
					return [entry, ...prev].slice(0, 200);
				});
			}
		},
		[normalizedSymbol],
	);

	const handleStreamError = useCallback(() => {
		pushError("stream", "unable to maintain realtime connection");
	}, [pushError]);

	useSimStream(handleStreamEvent, handleStreamError, { accountId });

	const topAsks = useMemo(() => (book?.asks ?? []).slice(0, 10), [book]);
	const topBids = useMemo(() => (book?.bids ?? []).slice(0, 10), [book]);

	const accountMetrics = useMemo(() => {
		if (!account) return [];

		const rawAvailable = account.availableCash ?? account.cashBalance;
		const available = Math.max(
			Math.min(rawAvailable ?? 0, account.equity ?? 0),
			0,
		);
		const borrowed = Math.max(
			account.borrowedBalance ?? Math.max(-account.cashBalance, 0),
			0,
		);

		const metrics = [
			{ label: "Account Value", value: formatUsd(account.equity) },
			{ label: "Available Cash", value: formatUsd(available) },
			{ label: "Realized PnL", value: formatUsd(account.totalRealizedPnl) },
			{ label: "Unrealized PnL", value: formatUsd(account.totalUnrealizedPnl) },
		];

		if (borrowed > 0.005) {
			metrics.splice(2, 0, {
				label: "Margin Used",
				value: formatUsd(borrowed),
			});
		}

		return metrics;
	}, [account]);

	const tradeSummary = useMemo(() => {
		if (completedTrades.length === 0) {
			return {
				totalTrades: 0,
				totalRealized: 0,
				avgTradeSize: null,
				medianTradeSize: null,
				percentLong: null,
				expectancy: null,
				avgLeverage: null,
				medianLeverage: null,
				maxLeverage: null,
				avgConfidence: null,
				medianConfidence: null,
			} as const;
		}

		const notionals = completedTrades
			.map((trade) => trade.notional)
			.filter((value): value is number => Number.isFinite(value) && value > 0);

		const totalRealized = completedTrades.reduce((sum, trade) => {
			return sum + (Number.isFinite(trade.realizedPnl) ? trade.realizedPnl : 0);
		}, 0);

		const leverageValues = completedTrades
			.map((trade) => trade.leverage)
			.filter(
				(value): value is number =>
					typeof value === "number" && Number.isFinite(value) && value > 0,
			);

		const confidenceValues = completedTrades
			.map((trade) => normalizeConfidenceRatio(trade.confidence))
			.filter(
				(value): value is number => value !== null && Number.isFinite(value),
			);

		const totalTrades = completedTrades.length;
		const longCount = completedTrades.filter(
			(trade) => trade.direction === "LONG",
		).length;

		return {
			totalTrades,
			totalRealized,
			avgTradeSize: average(notionals),
			medianTradeSize: median(notionals),
			percentLong: totalTrades > 0 ? longCount / totalTrades : null,
			expectancy: totalTrades > 0 ? totalRealized / totalTrades : null,
			avgLeverage: average(leverageValues),
			medianLeverage: median(leverageValues),
			maxLeverage: leverageValues.length ? Math.max(...leverageValues) : null,
			avgConfidence: average(confidenceValues),
			medianConfidence: median(confidenceValues),
		} as const;
	}, [completedTrades]);

	const renderCurrencyMetric = (value: number | null | undefined) => {
		if (value === null || value === undefined || !Number.isFinite(value)) {
			return <span className="text-muted-foreground">—</span>;
		}
		return (
			<NumberFlow
				value={value}
				format={{
					style: "currency",
					currency: "USD",
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				}}
			/>
		);
	};

	const renderPercentMetric = (
		ratio: number | null | undefined,
		fractionDigits = 1,
	) => {
		if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
			return <span className="text-muted-foreground">—</span>;
		}
		return (
			<NumberFlow
				value={ratio}
				format={{
					style: "percent",
					minimumFractionDigits: fractionDigits,
					maximumFractionDigits: fractionDigits,
				}}
			/>
		);
	};

	const renderLeverageMetric = (value: number | null | undefined) => {
		if (value === null || value === undefined || !Number.isFinite(value)) {
			return <span className="text-muted-foreground">—</span>;
		}
		return (
			<span className="inline-flex items-baseline gap-1 text-foreground">
				<NumberFlow
					value={value}
					format={{
						style: "decimal",
						minimumFractionDigits: 2,
						maximumFractionDigits: 2,
					}}
				/>
				<span className="text-xs font-medium text-muted-foreground">x</span>
			</span>
		);
	};

	const analyticsMetrics = useMemo(
		() => [
			{
				label: "Acct Value",
				variant: "currency" as const,
				value: account?.equity ?? null,
			},
			{
				label: "Avg Trade Size",
				variant: "currency" as const,
				value: tradeSummary.avgTradeSize,
			},
			{
				label: "Median Trade Size",
				variant: "currency" as const,
				value: tradeSummary.medianTradeSize,
			},
			{
				label: "% Long Trades",
				variant: "percent" as const,
				value: tradeSummary.percentLong,
			},
			{
				label: "Expectancy",
				variant: "currency" as const,
				value: tradeSummary.expectancy,
			},
			{
				label: "Avg Leverage",
				variant: "leverage" as const,
				value: tradeSummary.avgLeverage,
			},
			{
				label: "Median Leverage",
				variant: "leverage" as const,
				value: tradeSummary.medianLeverage,
			},
			{
				label: "Max Leverage",
				variant: "leverage" as const,
				value: tradeSummary.maxLeverage,
			},
			{
				label: "Avg Confidence",
				variant: "percent" as const,
				value: tradeSummary.avgConfidence,
			},
			{
				label: "Median Confidence",
				variant: "percent" as const,
				value: tradeSummary.medianConfidence,
			},
		],
		[account?.equity, tradeSummary],
	);

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div className="space-y-1">
						<CardTitle className="text-xl font-semibold">
							Simulator Control Panel
						</CardTitle>
						<p className="text-muted-foreground text-sm">
							Interact with the simulated exchange and monitor account state in
							real time.
						</p>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
						<div className="space-y-1">
							<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Account
							</span>
							<Select value={accountId} onValueChange={setAccountId}>
								<SelectTrigger id={accountSelectId} className="w-56">
									<SelectValue placeholder="Select account" />
								</SelectTrigger>
								<SelectContent>
									{accountOptions.map((option) => (
										<SelectItem key={option.id} value={option.id}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="self-start"
							onClick={() => resetAccount(accountId)}
							disabled={!accountId || isResetting}
						>
							{isResetting ? "Resetting…" : "Reset balance"}
						</Button>
					</div>
				</CardHeader>
				{accountMetrics.length > 0 && (
					<CardContent>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							{accountMetrics.map((metric) => (
								<div
									key={metric.label}
									className="rounded-lg border bg-muted/30 p-4"
								>
									<p className="text-sm text-muted-foreground">
										{metric.label}
									</p>
									<p className="text-lg font-semibold">{metric.value}</p>
								</div>
							))}
						</div>
					</CardContent>
				)}
			</Card>

			<Card className="border border-border/70 bg-card/80 shadow-sm">
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<CardTitle className="text-lg">Completed Trade Metrics</CardTitle>
						<p className="text-sm text-muted-foreground">
							{tradeSummary.totalTrades > 0
								? `Aggregated from ${tradeSummary.totalTrades} closed ${tradeSummary.totalTrades === 1 ? "trade" : "trades"}.`
								: "Closed trade analytics will appear once positions have been closed."}
						</p>
					</div>
					{tradeSummary.totalTrades > 0 && (
						<div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
							<span className="inline-flex items-baseline gap-1">
								<span className="font-semibold text-foreground">
									Realized PnL:
								</span>
								{renderCurrencyMetric(tradeSummary.totalRealized)}
							</span>
							<span className="inline-flex items-baseline gap-1">
								<span className="font-semibold text-foreground">
									Closed Trades:
								</span>
								<NumberFlow
									value={tradeSummary.totalTrades}
									format={{ maximumFractionDigits: 0 }}
								/>
							</span>
						</div>
					)}
				</CardHeader>
				<CardContent>
					{tradeSummary.totalTrades === 0 ? (
						<div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
							Close a simulated position to unlock expectancy, leverage, and
							confidence analytics.
						</div>
					) : (
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{analyticsMetrics.map((metric) => (
								<div
									key={metric.label}
									className="rounded-xl border border-border/60 bg-muted/15 p-4 shadow-sm"
								>
									<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
										{metric.label}
									</p>
									<div className="mt-2 text-lg font-semibold text-foreground">
										{metric.variant === "currency"
											? renderCurrencyMetric(metric.value as number | null)
											: metric.variant === "percent"
												? renderPercentMetric(metric.value as number | null)
												: renderLeverageMetric(metric.value as number | null)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card className="border-dashed border-border/60 bg-muted/10">
					<CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<CardTitle className="text-lg">Order Book · {symbol}</CardTitle>
							{book && (
								<p className="text-muted-foreground text-sm">
									Spread: {numberFormatter.format(book.spread)} · Mid:{" "}
									{formatUsd(book.midPrice)}
								</p>
							)}
						</div>
						<Select
							value={symbol}
							onValueChange={(value) =>
								setSymbol(value as (typeof SYMBOLS)[number])
							}
						>
							<SelectTrigger className="w-32">
								<SelectValue placeholder="Symbol" />
							</SelectTrigger>
							<SelectContent>
								{SYMBOLS.map((item) => (
									<SelectItem key={item} value={item}>
										{item}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</CardHeader>
					<CardContent>
						{book ? (
							<div className="grid gap-6 lg:grid-cols-2">
								<div>
									<h3 className="mb-2 text-sm font-semibold text-red-500">
										Asks
									</h3>
									<div className="rounded-md border">
										<table className="w-full text-sm">
											<thead>
												<tr className="border-b text-xs uppercase text-muted-foreground">
													<th className="p-2 text-left">Price</th>
													<th className="p-2 text-right">Size</th>
												</tr>
											</thead>
											<tbody>
												{topAsks.map((level) => (
													<tr
														key={`${level.price}-${level.quantity}`}
														className="border-b last:border-b-0"
													>
														<td className="p-2 text-left text-red-500">
															{numberFormatter.format(level.price)}
														</td>
														<td className="p-2 text-right">
															{level.quantity.toFixed(4)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
								<div>
									<h3 className="mb-2 text-sm font-semibold text-emerald-500">
										Bids
									</h3>
									<div className="rounded-md border">
										<table className="w-full text-sm">
											<thead>
												<tr className="border-b text-xs uppercase text-muted-foreground">
													<th className="p-2 text-left">Price</th>
													<th className="p-2 text-right">Size</th>
												</tr>
											</thead>
											<tbody>
												{topBids.map((level) => (
													<tr
														key={`${level.price}-${level.quantity}`}
														className="border-b last:border-b-0"
													>
														<td className="p-2 text-left text-emerald-500">
															{numberFormatter.format(level.price)}
														</td>
														<td className="p-2 text-right">
															{level.quantity.toFixed(4)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								Waiting for order book data…
							</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Open Positions</CardTitle>
					</CardHeader>
					<CardContent>
						{account && account.positions.length > 0 ? (
							<div className="overflow-x-auto">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b text-xs uppercase text-muted-foreground">
											<th className="p-2 text-left">Symbol</th>
											<th className="p-2 text-left">Side</th>
											<th className="p-2 text-right">Qty</th>
											<th className="p-2 text-right">Entry</th>
											<th className="p-2 text-right">Mark</th>
											<th className="p-2 text-right">Realized</th>
											<th className="p-2 text-right">Unrealized</th>
										</tr>
									</thead>
									<tbody>
										{account.positions.map((position) => (
											<tr
												key={position.symbol}
												className="border-b last:border-b-0"
											>
												<td className="p-2 text-left">{position.symbol}</td>
												<td className="p-2 text-left">{position.side}</td>
												<td className="p-2 text-right">
													{position.quantity.toFixed(4)}
												</td>
												<td className="p-2 text-right">
													{numberFormatter.format(position.avgEntryPrice)}
												</td>
												<td className="p-2 text-right">
													{numberFormatter.format(position.markPrice)}
												</td>
												<td className="p-2 text-right">
													{formatUsd(position.realizedPnl)}
												</td>
												<td
													className={`p-2 text-right ${position.unrealizedPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}
												>
													{formatUsd(position.unrealizedPnl)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								No open positions for this account.
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			{errors.length > 0 && (
				<Card className="border-destructive/60 bg-destructive/5">
					<CardHeader>
						<CardTitle className="text-lg text-destructive">Alerts</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="space-y-2 text-sm">
							{errors.map((error) => (
								<li key={error} className="font-mono">
									{error}
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
