import NumberFlow from "@number-flow/react";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useVariant } from "@/components/variant-provider";
import { VariantSelector } from "@/components/variant-selector";
import {
	MARKETS,
	SUPPORTED_MARKETS,
} from "@/core/shared/markets/marketMetadata";
import {
	type MarketPrice,
	useMarketPrices,
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

export default function CryptoTracker() {
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
			return [];
		}

		const bySymbol = new Map(prices.map((price) => [price.symbol, price]));
		const next: CryptoTicker[] = [];

		for (const symbol of TRACKED_SYMBOLS) {
			const latest = bySymbol.get(symbol);
			if (!latest) continue;
			next.push({
				symbol,
				price: latest.price,
				change24h: latest.change24h,
				source: latest.source,
			});
		}

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
							const style = MARKETS[ticker.symbol];
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
	decimals,
}: {
	value: number;
	change: number | null;
	decimals: number;
}) {
	const hasValidPrice = Number.isFinite(value);

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
		<div className="flex items-center gap-2 sm:gap-4 flex-nowrap">
			{TRACKED_SYMBOLS.map((symbol) => (
				<div
					key={symbol}
					className="flex min-w-[82px] flex-col items-center gap-1 sm:min-w-[140px] sm:gap-1.5"
				>
					<div className="flex items-center gap-1 sm:gap-2">
						<Skeleton className="h-6 w-6 rounded-full" />
						<Skeleton className="h-3 w-8 sm:h-4 sm:w-10" />
					</div>
					<Skeleton className="h-3.5 w-16 sm:h-5 sm:w-24" />
				</div>
			))}
		</div>
	);
}
