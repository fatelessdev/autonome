import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SUPPORTED_MARKETS } from "@/core/shared/markets/marketMetadata";
import {
	MARKET_QUERIES,
	type MarketPrice,
} from "@/core/shared/markets/marketQueries";

const TRACKED_SYMBOLS = SUPPORTED_MARKETS;
const TRACKED_SYMBOL_SET = new Set(TRACKED_SYMBOLS);

type CoinSymbol = (typeof TRACKED_SYMBOLS)[number];

type CryptoTicker = {
	symbol: CoinSymbol;
	price: number;
	change24h: number | null;
	source: MarketPrice["source"];
};

const COIN_STYLES: Record<
	CoinSymbol,
	{ badge: string; logo: string; decimals: number }
> = {
	BTC: { badge: "BTC", logo: "/btc.svg", decimals: 2 },
	ETH: { badge: "ETH", logo: "/eth.svg", decimals: 2 },
	SOL: { badge: "SOL", logo: "/sol.svg", decimals: 3 },
};

export default function CryptoTracker() {
	const previousTickersRef = useRef<CryptoTicker[]>([]);

	const {
		data: marketPrices,
		isPending,
		isRefetching,
		isError,
	} = useQuery(MARKET_QUERIES.prices(TRACKED_SYMBOLS));

	const sanitizedPrices = useMemo(() => {
		if (!marketPrices) return null;
		return sanitizePrices(marketPrices);
	}, [marketPrices]);

	const displayTickers = useMemo(() => {
		const prices = sanitizedPrices ?? [];
		if (prices.length === 0) {
			return previousTickersRef.current;
		}

		const previous = previousTickersRef.current;
		const previousBySymbol = new Map(
			previous.map((entry) => [entry.symbol, entry]),
		);

		const next: CryptoTicker[] = [];

		TRACKED_SYMBOLS.forEach((symbol) => {
			const latest = prices.find((price) => price.symbol === symbol);
			if (!latest) {
				const fallback = previousBySymbol.get(symbol);
				if (fallback) {
					next.push(fallback);
				}
				return;
			}

			next.push({
				symbol,
				price: latest.price,
				change24h: latest.change24h,
				source: latest.source,
			});
		});

		previousTickersRef.current = next;
		return next;
	}, [sanitizedPrices]);

	const shouldShowSkeleton =
		(isPending || isRefetching) && displayTickers.length === 0;
	const shouldShowError = isError && !isPending && displayTickers.length === 0;

	return (
		<div className="flex items-center border-b py-[5px] px-6">
			{shouldShowSkeleton ? (
				<TickerSkeleton />
			) : shouldShowError ? (
				<p className="text-center text-muted-foreground text-sm">
					Unable to load market prices. Retrying shortly...
				</p>
			) : displayTickers.length === 0 ? (
				<p className="text-center text-muted-foreground text-sm">
					Fetching market prices...
				</p>
			) : (
				<div className="flex w-full flex-wrap items-center justify-center sm:justify-start sm:gap-4">
					{displayTickers.map((ticker, index) => {
						const style = COIN_STYLES[ticker.symbol];
						return (
							<React.Fragment key={ticker.symbol}>
								<div className="flex min-w-[92px] flex-1 flex-col items-center sm:min-w-[140px] sm:gap-1">
									<div className="flex items-center gap-1.5 sm:gap-2">
										<img
											src={style.logo}
											alt={`${ticker.symbol} logo`}
											width={16}
											height={16}
											loading="lazy"
										/>
										<div className="text-muted-foreground text-xs sm:text-sm">
											{style.badge}
										</div>
									</div>
									<PriceWithChange
										value={ticker.price}
										change={ticker.change24h}
										decimals={style.decimals}
										source={ticker.source}
									/>
								</div>
								{index !== displayTickers.length - 1 ? (
									<div className="hidden h-10 w-px bg-border sm:block" />
								) : null}
							</React.Fragment>
						);
					})}
				</div>
			)}
		</div>
	);
}

function PriceWithChange({
	value,
	change,
	decimals,
	source,
}: {
	value: number;
	change: number | null;
	decimals: number;
	source: MarketPrice["source"];
}) {
	const hasValidPrice = Number.isFinite(value);
	const formattedChange =
		typeof change === "number" && Number.isFinite(change) ? change : null;

	return (
		<div className="flex flex-col items-center gap-1">
			{hasValidPrice ? (
				<NumberFlow
					value={value}
					className="font-mono text-sm font-semibold"
					format={{
						style: "currency",
						currency: "USD",
						minimumFractionDigits: decimals,
						maximumFractionDigits: decimals,
					}}
				/>
			) : (
				<span className="text-xs text-muted-foreground">No data</span>
			)}
			<div className="flex items-center gap-1 text-xs">
				<span
					className={
						formattedChange == null
							? "text-muted-foreground"
							: formattedChange >= 0
								? "text-emerald-400"
								: "text-rose-400"
					}
				>
					{/* {formattedChange == null
						? "–"
						: `${formattedChange >= 0 ? "+" : ""}${formattedChange.toFixed(2)}%`} */}
				</span>
				{/* <span className="text-muted-foreground">· {source}</span> */}
			</div>
		</div>
	);
}

function sanitizePrices(prices: MarketPrice[]): MarketPrice[] {
	return prices.filter(
		(price) =>
			TRACKED_SYMBOL_SET.has(price.symbol) && Number.isFinite(price.price),
	);
}

function TickerSkeleton() {
	return (
		<div className="flex w-full flex-wrap items-center justify-center gap-2.5 sm:justify-start sm:gap-4">
			{TRACKED_SYMBOLS.map((symbol) => (
				<div
					key={symbol}
					className="flex min-w-[92px] flex-1 flex-col items-center gap-1.5 sm:min-w-[140px] sm:gap-2"
				>
					<div className="flex items-center gap-1.5 sm:gap-2">
						<Skeleton className="h-3.5 w-12 sm:h-4 sm:w-14" />
						<Skeleton className="h-3.5 w-8 sm:h-4 sm:w-10" />
					</div>
					<Skeleton className="h-4 w-20 sm:h-5 sm:w-24" />
				</div>
			))}
		</div>
	);
}
