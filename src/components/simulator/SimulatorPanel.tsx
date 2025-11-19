import NumberFlow from "@number-flow/react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import * as Recharts from "recharts";

import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ChartContainer, ChartTooltipContent } from "../ui/chart";
import { Progress } from "../ui/progress";
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
					timestamp: Date.now(),
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

	const topAsks = useMemo(() => (book?.asks ?? []).slice(0, 12), [book]);
	const topBids = useMemo(() => (book?.bids ?? []).slice(0, 12), [book]);

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
			{ label: "Account Value", value: account.equity, change: null },
			{ label: "Available Cash", value: available, change: null },
			{ label: "Realized PnL", value: account.totalRealizedPnl, change: null },
			{
				label: "Unrealized PnL",
				value: account.totalUnrealizedPnl,
				change: null,
			},
		];

		if (borrowed > 0.005) {
			metrics.splice(2, 0, {
				label: "Margin Used",
				value: borrowed,
				change: null,
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
				winRate: null,
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

		const winningTrades = completedTrades.filter(
			(trade) => trade.realizedPnl > 0,
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
			winRate: totalTrades > 0 ? winningTrades / totalTrades : null,
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
				label: "Win Rate",
				variant: "percent" as const,
				value: tradeSummary.winRate,
			},
			{
				label: "Avg Leverage",
				variant: "leverage" as const,
				value: tradeSummary.avgLeverage,
			},
			{
				label: "Avg Confidence",
				variant: "percent" as const,
				value: tradeSummary.avgConfidence,
			},
		],
		[account?.equity, tradeSummary],
	);

	const chartData = useMemo(() => {
		if (completedTrades.length === 0) return [];

		return [...completedTrades]
			.reverse()
			.slice(0, 30)
			.map((trade, index) => ({
				name: `#${completedTrades.length - index}`,
				pnl: trade.realizedPnl,
				confidence: normalizeConfidenceRatio(trade.confidence) ?? 0,
				leverage: trade.leverage ?? 0,
			}));
	}, [completedTrades]);

	const leverageDistribution = useMemo(() => {
		if (completedTrades.length === 0) return [];

		const buckets: Record<string, number> = {
			"0-2x": 0,
			"2-5x": 0,
			"5-10x": 0,
			"10x+": 0,
		};

		completedTrades.forEach((trade) => {
			if (trade.leverage) {
				if (trade.leverage <= 2) buckets["0-2x"]++;
				else if (trade.leverage <= 5) buckets["2-5x"]++;
				else if (trade.leverage <= 10) buckets["5-10x"]++;
				else buckets["10x+"]++;
			}
		});

		return Object.entries(buckets).map(([range, count]) => ({
			range,
			count,
		}));
	}, [completedTrades]);

	return (
		<div className="flex flex-col gap-6">
			{/* Account Controls */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Symbol:
						</span>
						<Tabs
							value={symbol}
							onValueChange={(value) =>
								setSymbol(value as (typeof SYMBOLS)[number])
							}
							className=""
						>
							<TabsList className="h-9">
								{SYMBOLS.map((item) => (
									<TabsTrigger key={item} value={item} className="h-7">
										{item}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Account:
						</span>
						<Select value={accountId} onValueChange={setAccountId}>
							<SelectTrigger
								id={accountSelectId}
								className="w-56 bg-background"
							>
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
						onClick={() => resetAccount(accountId)}
						disabled={!accountId || isResetting}
					>
						{isResetting ? "Resetting…" : "Reset"}
					</Button>
				</div>
			</div>

			{/* Account Metrics */}
			{accountMetrics.length > 0 && (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
					{accountMetrics.map((metric) => (
						<Card
							key={metric.label}
							className="bg-gradient-to-br from-card to-card/60 border-border/60"
						>
							<CardContent className="p-4">
								<p className="text-xs font-medium text-muted-foreground">
									{metric.label}
								</p>
								<div className="mt-2 flex items-baseline gap-2">
									<p className="text-xl font-bold">
										{renderCurrencyMetric(metric.value)}
									</p>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Main Content Grid */}
			<div className="grid gap-6 lg:grid-cols-3">
				{/* Order Book */}
				<Card className="lg:col-span-2 border-border/60 bg-card/50">
					<CardHeader className="flex flex-row items-center justify-between pb-3">
						<div>
							<CardTitle className="text-lg">Order Book</CardTitle>
							{book && (
								<p className="text-sm text-muted-foreground">
									Spread: {numberFormatter.format(book.spread)} · Mid:{" "}
									{formatUsd(book.midPrice)}
								</p>
							)}
						</div>
						<Badge variant="secondary" className="font-mono text-xs">
							{symbol}
						</Badge>
					</CardHeader>
					<CardContent>
						{book ? (
							<div className="grid gap-6 md:grid-cols-2">
								<div>
									<div className="mb-2 flex items-center justify-between">
										<h3 className="text-sm font-semibold text-red-400">Asks</h3>
										<span className="text-xs text-muted-foreground">
											{topAsks.length} levels
										</span>
									</div>
									<div className="space-y-1">
										{topAsks.map((level) => (
											<div
												key={`ask-${level.price}`}
												className="group grid grid-cols-[1fr_auto] gap-2 rounded px-2 py-1 hover:bg-muted/50"
											>
												<span className="text-sm font-medium text-red-400">
													{numberFormatter.format(level.price)}
												</span>
												<span className="text-sm tabular-nums text-muted-foreground group-hover:text-foreground">
													{level.quantity.toFixed(4)}
												</span>
											</div>
										))}
									</div>
								</div>
								<div>
									<div className="mb-2 flex items-center justify-between">
										<h3 className="text-sm font-semibold text-emerald-400">
											Bids
										</h3>
										<span className="text-xs text-muted-foreground">
											{topBids.length} levels
										</span>
									</div>
									<div className="space-y-1">
										{topBids.map((level) => (
											<div
												key={`bid-${level.price}`}
												className="group grid grid-cols-[1fr_auto] gap-2 rounded px-2 py-1 hover:bg-muted/50"
											>
												<span className="text-sm font-medium text-emerald-400">
													{numberFormatter.format(level.price)}
												</span>
												<span className="text-sm tabular-nums text-muted-foreground group-hover:text-foreground">
													{level.quantity.toFixed(4)}
												</span>
											</div>
										))}
									</div>
								</div>
							</div>
						) : (
							<div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
								Waiting for order book data…
							</div>
						)}
					</CardContent>
				</Card>

				{/* Right Column: Positions & Trade Activity */}
				<div className="flex flex-col gap-6">
					{/* Open Positions */}
					<Card className="border-border/60 bg-card/50">
						<CardHeader className="pb-3">
							<CardTitle className="text-lg">Open Positions</CardTitle>
						</CardHeader>
						<CardContent>
							{account && account.positions.length > 0 ? (
								<div className="space-y-2">
									{account.positions.map((position) => (
										<div
											key={position.symbol}
											className="rounded-lg border border-border/40 bg-muted/30 p-3"
										>
											<div className="mb-2 flex items-center justify-between">
												<div className="flex items-center gap-2">
													<span className="font-semibold">
														{position.symbol}
													</span>
													<Badge
														variant={
															position.side === "LONG"
																? "default"
																: "destructive"
														}
														className="text-[10px]"
													>
														{position.side}
													</Badge>
												</div>
												<span className="text-sm text-muted-foreground">
													{position.quantity.toFixed(4)}
												</span>
											</div>
											<div className="grid grid-cols-2 gap-2 text-xs">
												<div>
													<span className="text-muted-foreground">Entry:</span>
													<span className="ml-2 font-medium">
														{numberFormatter.format(position.avgEntryPrice)}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">Mark:</span>
													<span className="ml-2 font-medium">
														{numberFormatter.format(position.markPrice)}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">
														Realized:
													</span>
													<span
														className={`ml-2 font-medium ${
															position.realizedPnl >= 0
																? "text-emerald-500"
																: "text-red-500"
														}`}
													>
														{formatUsd(position.realizedPnl)}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">
														Unrealized:
													</span>
													<span
														className={`ml-2 font-medium ${
															position.unrealizedPnl >= 0
																? "text-emerald-500"
																: "text-red-500"
														}`}
													>
														{formatUsd(position.unrealizedPnl)}
													</span>
												</div>
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									No open positions
								</p>
							)}
						</CardContent>
					</Card>

					{/* Trade Summary */}
					<Card className="border-border/60 bg-card/50">
						<CardHeader className="pb-3">
							<CardTitle className="text-lg">Trade Summary</CardTitle>
						</CardHeader>
						<CardContent>
							{tradeSummary.totalTrades === 0 ? (
								<p className="text-sm text-muted-foreground">
									No completed trades
								</p>
							) : (
								<div className="space-y-4">
									<div className="flex items-center justify-between border-b border-border/40 pb-3">
										<span className="text-sm text-muted-foreground">
											Total Realized
										</span>
										<span
											className={`text-lg font-bold ${
												tradeSummary.totalRealized >= 0
													? "text-emerald-500"
													: "text-red-500"
											}`}
										>
											{renderCurrencyMetric(tradeSummary.totalRealized)}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-sm text-muted-foreground">
											Closed Trades
										</span>
										<span className="text-lg font-bold">
											{tradeSummary.totalTrades}
										</span>
									</div>
									{tradeSummary.winRate !== null && (
										<div className="space-y-2">
											<div className="flex items-center justify-between">
												<span className="text-sm text-muted-foreground">
													Win Rate
												</span>
												<span className="text-sm font-semibold">
													{renderPercentMetric(tradeSummary.winRate)}
												</span>
											</div>
											<Progress
												value={tradeSummary.winRate * 100}
												className="h-2"
											/>
										</div>
									)}
									{tradeSummary.expectancy !== null && (
										<div className="flex items-center justify-between">
											<span className="text-sm text-muted-foreground">
												Expectancy
											</span>
											<span
												className={`text-sm font-semibold ${
													tradeSummary.expectancy >= 0
														? "text-emerald-500"
														: "text-red-500"
												}`}
											>
												{renderCurrencyMetric(tradeSummary.expectancy)}
											</span>
										</div>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Analytics Charts */}
			{tradeSummary.totalTrades > 0 && (
				<Card className="border-border/60 bg-card/50">
					<CardHeader>
						<CardTitle className="text-lg">Trade Analytics</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid gap-6 md:grid-cols-2">
							{/* PnL Chart */}
							<div className="space-y-3">
								<h3 className="text-sm font-semibold">PnL Over Time</h3>
								<ChartContainer
									config={{
										pnl: {
											label: "PnL",
											color: "hsl(var(--primary))",
										},
									}}
									className="h-[200px]"
								>
									<Recharts.AreaChart data={chartData}>
										<Recharts.Area
											type="monotone"
											dataKey="pnl"
											stroke="hsl(var(--primary))"
											fill="hsl(var(--primary))"
											fillOpacity={0.2}
										/>
										<Recharts.CartesianGrid strokeDasharray="3 3" />
										<Recharts.Tooltip
											content={
												<ChartTooltipContent
													formatter={(value) => formatUsd(value as number)}
												/>
											}
										/>
									</Recharts.AreaChart>
								</ChartContainer>
							</div>

							{/* Leverage Distribution */}
							<div className="space-y-3">
								<h3 className="text-sm font-semibold">Leverage Distribution</h3>
								<ChartContainer
									config={{
										count: {
											label: "Trades",
											color: "hsl(var(--primary))",
										},
									}}
									className="h-[200px]"
								>
									<Recharts.BarChart data={leverageDistribution}>
										<Recharts.Bar
											dataKey="count"
											fill="hsl(var(--primary))"
											radius={[4, 4, 0, 0]}
										/>
										<Recharts.CartesianGrid strokeDasharray="3 3" />
										<Recharts.Tooltip content={<ChartTooltipContent />} />
									</Recharts.BarChart>
								</ChartContainer>
							</div>
						</div>

						{/* Metrics Grid */}
						<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							{analyticsMetrics.map((metric) => (
								<div
									key={metric.label}
									className="rounded-xl border border-border/60 bg-muted/15 p-4"
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
					</CardContent>
				</Card>
			)}

			{/* Errors */}
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
