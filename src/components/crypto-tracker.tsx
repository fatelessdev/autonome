import NumberFlow from "@number-flow/react";
import { useMemo, useRef } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { VariantSelector } from "@/components/variant-selector";
import { useVariant } from "@/components/variant-context";
import { SUPPORTED_MARKETS } from "@/core/shared/markets/marketMetadata";
import { useMarketPrices, type MarketPrice } from "@/core/shared/markets/marketQueries";

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
	BTC: { badge: "BTC", logo: "/coins/btc.svg", decimals: 2 },
	ETH: { badge: "ETH", logo: "/coins/eth.svg", decimals: 2 },
	SOL: { badge: "SOL", logo: "/coins/sol.svg", decimals: 3 },
	ZEC: { badge: "ZEC", logo: "/coins/zec.webp", decimals: 3 },
	HYPE: { badge: "HYPE", logo: "/coins/hype.webp", decimals: 4 },
};

export default function CryptoTracker() {
	const previousTickersRef = useRef<CryptoTicker[]>([]);
	const { selectedVariant, setSelectedVariant } = useVariant();

	const {
		data: marketPrices,
		isPending,
		isRefetching,
		isError,
	} = useMarketPrices(TRACKED_SYMBOLS);

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
		<div className="border-b px-4 py-2 sm:px-6 sm:py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div
				className="flex items-center gap-2 sm:gap-4 overflow-x-auto flex-nowrap scrollbar-hide"
				style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
			>
				{shouldShowSkeleton ? (
					<TickerSkeleton />
				) : shouldShowError ? (
					<p className="text-muted-foreground text-sm">
						Unable to load market prices. Retrying shortly...
					</p>
				) : displayTickers.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Fetching market prices...
					</p>
				) : (
					<div className="flex items-center gap-2 sm:gap-4 flex-nowrap">
						{displayTickers.map((ticker) => {
							const style = COIN_STYLES[ticker.symbol];
							return (
								<div
									key={ticker.symbol}
									className="flex min-w-[82px] flex-col items-center gap-1 sm:min-w-[140px] sm:gap-1.5"
								>
									<div className="flex items-center gap-1 sm:gap-2">
										<img
											src={style.logo}
											alt={`${ticker.symbol} logo`}
											width={16}
											height={16}
											loading="lazy"
											className="flex-shrink-0 h-4"
										/>
										<div className="text-muted-foreground text-[9px] sm:text-sm font-semibold">
											{style.badge}
										</div>
									</div>
									<PriceWithChange
										value={ticker.price}
										change={ticker.change24h}
										decimals={style.decimals}
									/>
								</div>
							);
						})}
					</div>
				)}
			</div>
			{/* Desktop only - variant selector on the right */}
			<div className="hidden sm:flex sm:items-center sm:justify-center">
				<VariantSelector
					layout="desktop"
					value={selectedVariant}
					onChange={setSelectedVariant}
				/>
			</div>
		</div>
	);
}

function PriceWithChange({
	value,
	change,
	decimals,
}: {
	value: number;
	change: number | null;
	decimals: number;
}) {
	const hasValidPrice = Number.isFinite(value);
	const formattedChange =
		typeof change === "number" && Number.isFinite(change) ? change : null;

	return (
		<div className="flex flex-col items-center gap-1 max-w-full">
			{hasValidPrice ? (
				<NumberFlow
					value={value}
					className="font-mono text-[8px] font-semibold sm:text-sm truncate"
					format={{
						style: "currency",
						currency: "USD",
						currencyDisplay: "narrowSymbol",
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
		<div
			className="flex w-full flex-nowrap items-center justify-start gap-2 sm:gap-4 overflow-x-auto scrollbar-hide"
			style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
		>
			{TRACKED_SYMBOLS.map((symbol) => (
				<div
					key={symbol}
					className="flex min-w-[82px] flex-col items-center gap-1 sm:min-w-[140px] sm:gap-1.5"
				>
					<div className="flex items-center gap-1 sm:gap-2">
						<Skeleton className="h-4 w-4 rounded-sm" />
						<Skeleton className="h-3 w-7 sm:h-4 sm:w-9" />
					</div>
					<Skeleton className="h-3.5 w-16 sm:h-5 sm:w-24" />
					<Skeleton className="h-2.5 w-10 sm:h-3 sm:w-12" />
				</div>
			))}
		</div>
	);
}
