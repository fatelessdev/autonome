export const MARKETS = {
	BTC: {
		marketId: 1,
		priceDecimals: 10,
		qtyDecimals: 100000,
		clientOrderIndex: 0,
		slClientOrderIndex: 100,  // SL orders use offset +100
		tpClientOrderIndex: 200,  // TP orders use offset +200
	},
	ETH: {
		marketId: 0,
		priceDecimals: 100,
		qtyDecimals: 10000,
		clientOrderIndex: 1,
		slClientOrderIndex: 101,
		tpClientOrderIndex: 201,
	},
	SOL: {
		marketId: 2,
		priceDecimals: 1000,
		qtyDecimals: 1000,
		clientOrderIndex: 2,
		slClientOrderIndex: 102,
		tpClientOrderIndex: 202,
	},
	ZEC: {
		marketId: 90,
		priceDecimals: 1000,
		qtyDecimals: 1000,
		clientOrderIndex: 3,
		slClientOrderIndex: 103,
		tpClientOrderIndex: 203,
	},
	HYPE: {
		marketId: 24,
		priceDecimals: 10000,
		qtyDecimals: 100,
		clientOrderIndex: 4,
		slClientOrderIndex: 104,
		tpClientOrderIndex: 204,
	},
} as const;

type MarketSymbol = keyof typeof MARKETS;

export const SUPPORTED_MARKETS: MarketSymbol[] = Object.keys(
	MARKETS,
) as MarketSymbol[];
