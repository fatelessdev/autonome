import { createFileRoute } from "@tanstack/react-router";
import {
	getCurrentTrades,
	getTradeCacheMetadata,
	subscribeToTradeEvents,
} from "@/server/features/trading/events/tradeEvents";
import { tradesQuery } from "@/server/features/trading/queries.server";
import { createSseDataStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseDataStream({
	name: "trades",
	getCurrentData: getCurrentTrades,
	subscribe: subscribeToTradeEvents,
	getCacheMetadata: getTradeCacheMetadata,
	hydrate: async () => {
		const options = tradesQuery();
		await options.queryFn({
			queryKey: options.queryKey,
		} as never);
	},
});

export const Route = createFileRoute("/api/events/trades")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
