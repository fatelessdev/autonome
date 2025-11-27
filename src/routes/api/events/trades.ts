import { createFileRoute } from "@tanstack/react-router";
import {
	emitTradeEvent,
	getCurrentTrades,
	getTradeCacheMetadata,
	subscribeToTradeEvents,
	type TradeEventData,
} from "@/server/features/trading/events/tradeEvents";
import { fetchTrades } from "@/server/features/trading/queries.server";
import { createSseDataStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseDataStream({
	name: "trades",
	getCurrentData: getCurrentTrades,
	subscribe: subscribeToTradeEvents,
	getCacheMetadata: getTradeCacheMetadata,
	hydrate: async () => {
		const trades = await fetchTrades();
		emitTradeEvent({
			type: "trades:updated",
			timestamp: new Date().toISOString(),
			data: trades as TradeEventData[],
		});
	},
});

export const Route = createFileRoute("/api/events/trades")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
