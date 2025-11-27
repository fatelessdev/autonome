import { createFileRoute } from "@tanstack/react-router";
import {
	emitPositionEvent,
	getCurrentPositions,
	getPositionCacheMetadata,
	subscribeToPositionEvents,
	type PositionEventData,
} from "@/server/features/trading/events/positionEvents";
import { fetchPositions } from "@/server/features/trading/queries.server";
import { createSseDataStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseDataStream({
	name: "positions",
	getCurrentData: getCurrentPositions,
	subscribe: subscribeToPositionEvents,
	getCacheMetadata: getPositionCacheMetadata,
	hydrate: async () => {
		const positions = await fetchPositions();
		emitPositionEvent({
			type: "positions:updated",
			timestamp: new Date().toISOString(),
			data: positions as PositionEventData[],
		});
	},
});

export const Route = createFileRoute("/api/events/positions")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
