/**
 * Market Metadata for Alpaca Trading
 *
 * Crypto symbols use "X/USD" format on Alpaca (e.g. "BTC/USD").
 * The `symbol` key is the Alpaca-formatted symbol.
 * `canonical` is the short form used in our DB and UI (e.g. "BTC").
 */
export const MARKETS = {
	BTC: {
		symbol: "BTC/USD",
		canonical: "BTC",
		assetClass: "crypto" as const,
	},
	ETH: {
		symbol: "ETH/USD",
		canonical: "ETH",
		assetClass: "crypto" as const,
	},
	SOL: {
		symbol: "SOL/USD",
		canonical: "SOL",
		assetClass: "crypto" as const,
	},
	XRP: {
		symbol: "XRP/USD",
		canonical: "XRP",
		assetClass: "crypto" as const,
	},
	HYPE: {
		symbol: "HYPE/USD",
		canonical: "HYPE",
		assetClass: "crypto" as const,
	},
} as const;

type MarketSymbol = keyof typeof MARKETS;

export const SUPPORTED_MARKETS: MarketSymbol[] = Object.keys(
	MARKETS,
) as MarketSymbol[];

const normalizeRawSymbol = (value: string) =>
	value.toUpperCase().trim().replace(/\s+/g, "");

/**
 * Resolve an Alpaca symbol (e.g. "BTC/USD") back to canonical form ("BTC").
 */
export function toCanonical(alpacaSymbol: string): string {
	const normalized = normalizeRawSymbol(alpacaSymbol);

	if (MARKETS[normalized as MarketSymbol]) {
		return normalized;
	}

	for (const market of Object.values(MARKETS)) {
		if (market.symbol === normalized) return market.canonical;
	}

	return normalized;
}

/**
 * Resolve a canonical symbol ("BTC") to the Alpaca API symbol ("BTC/USD").
 */
export function toAlpacaSymbol(canonical: string): string {
	const normalized = normalizeRawSymbol(canonical);

	for (const market of Object.values(MARKETS)) {
		if (market.symbol === normalized) {
			return market.symbol;
		}
	}

	const base = toCanonical(normalized).toUpperCase();
	const market = MARKETS[base as MarketSymbol];
	if (!market) {
		throw new Error(`Unsupported Alpaca market symbol: ${canonical}`);
	}

	return market.symbol;
}
