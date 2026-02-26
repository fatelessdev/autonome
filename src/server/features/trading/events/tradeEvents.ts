import { createTypedEventBus } from "@/server/events/typedEventBus";

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

const bus = createTypedEventBus<TradeEvent>("trade-update");

let currentTradesCache: TradeEventData[] = [];
let lastTradesUpdateAt: number | null = null;

export const emitTradeEvent = (event: TradeEvent): void => {
	currentTradesCache = event.data;
	lastTradesUpdateAt = Date.now();
	bus.emit(event);
};

export const subscribeToTradeEvents = bus.subscribe;

export const getCurrentTrades = (): TradeEventData[] => currentTradesCache;

export const getTradeCacheMetadata = () => ({
	count: currentTradesCache.length,
	lastUpdatedAt: lastTradesUpdateAt,
});
