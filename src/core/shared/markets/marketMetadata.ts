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
		badge: "BTC",
		logo: "/coins/btc.svg",
		decimals: 2,
	},
	ETH: {
		symbol: "ETH/USD",
		canonical: "ETH",
		assetClass: "crypto" as const,
		badge: "ETH",
		logo: "/coins/eth.svg",
		decimals: 2,
	},
	SOL: {
		symbol: "SOL/USD",
		canonical: "SOL",
		assetClass: "crypto" as const,
		badge: "SOL",
		logo: "/coins/sol.svg",
		decimals: 3,
	},
	XRP: {
		symbol: "XRP/USD",
		canonical: "XRP",
		assetClass: "crypto" as const,
		badge: "XRP",
		logo: "/coins/xrp.svg",
		decimals: 4,
	},
	HYPE: {
		symbol: "HYPE/USD",
		canonical: "HYPE",
		assetClass: "crypto" as const,
		badge: "HYPE",
		logo: "/coins/hype.webp",
		decimals: 4,
	},
} as const;

export type MarketSymbol = keyof typeof MARKETS;

export const SUPPORTED_MARKETS: MarketSymbol[] = Object.keys(
	MARKETS,
) as MarketSymbol[];

export function isSupportedMarketSymbol(value: string): value is MarketSymbol {
	return value in MARKETS;
}

const normalizeRawSymbol = (value: string) =>
	value.toUpperCase().trim().replace(/\s+/g, "");

function findMarketByAlpacaSymbol(normalizedSymbol: string) {
	return Object.values(MARKETS).find(
		(market) => market.symbol === normalizedSymbol,
	);
}

/**
 * Resolve an Alpaca symbol (e.g. "BTC/USD") or canonical symbol (e.g. "BTC")
 * back to canonical form ("BTC").
 */
export function toCanonical(alpacaSymbol: string): string {
	const normalized = normalizeRawSymbol(alpacaSymbol);
	const direct = MARKETS[normalized as MarketSymbol];
	if (direct) {
		return direct.canonical;
	}

	const market = findMarketByAlpacaSymbol(normalized);
	if (market) {
		return market.canonical;
	}

	throw new Error(`Unsupported Alpaca market symbol: ${alpacaSymbol}`);
}

/**
 * Resolve a canonical symbol ("BTC") to the Alpaca API symbol ("BTC/USD").
 */
export function toAlpacaSymbol(canonical: string): string {
	const normalized = normalizeRawSymbol(canonical);
	const direct = MARKETS[normalized as MarketSymbol];
	if (direct) {
		return direct.symbol;
	}

	const market = findMarketByAlpacaSymbol(normalized);
	if (market) {
		return market.symbol;
	}

	throw new Error(`Unsupported Alpaca market symbol: ${canonical}`);
}
