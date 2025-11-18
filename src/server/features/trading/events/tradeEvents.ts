import { EventEmitter } from "node:events";

export type TradeEventData = {
	id: string;
	modelId: string;
	modelName: string;
	modelRouterName: string;
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	entryNotional: number | null;
	exitNotional: number | null;
	netPnl: number | null;
	openedAt: string | null;
	closedAt: string | null;
	holdingTime: string | null;
	timestamp: string | null;
};

export type TradeEvent = {
	type: "trades:updated";
	timestamp: string;
	data: TradeEventData[];
};

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const EVENT_KEY = "trade-update";

// Cache for current trades
let currentTradesCache: TradeEventData[] = [];
let lastTradesUpdateAt: number | null = null;

export const emitTradeEvent = (event: TradeEvent) => {
	currentTradesCache = event.data;
	lastTradesUpdateAt = Date.now();
	emitter.emit(EVENT_KEY, event);
};

export const subscribeToTradeEvents = (
	listener: (event: TradeEvent) => void,
) => {
	emitter.on(EVENT_KEY, listener);
	return () => {
		emitter.off(EVENT_KEY, listener);
	};
};

export const getCurrentTrades = () => {
	return currentTradesCache;
};

export const getTradeCacheMetadata = () => {
	return {
		count: currentTradesCache.length,
		lastUpdatedAt: lastTradesUpdateAt,
	};
};
