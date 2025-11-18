export const MARKETS = {
	BTC: {
		marketId: 1,
		priceDecimals: 10,
		qtyDecimals: 100000,
		clientOrderIndex: 0,
	},
	ETH: {
		marketId: 0,
		priceDecimals: 100,
		qtyDecimals: 10000,
		clientOrderIndex: 1,
	},
	SOL: {
		marketId: 2,
		priceDecimals: 1000,
		qtyDecimals: 1000,
		clientOrderIndex: 2,
	},
} as const;

type MarketSymbol = keyof typeof MARKETS;

export const SUPPORTED_MARKETS: MarketSymbol[] = Object.keys(
	MARKETS,
) as MarketSymbol[];
