import { createFileRoute } from "@tanstack/react-router";
import {
	getCurrentPositions,
	getPositionCacheMetadata,
	subscribeToPositionEvents,
} from "@/server/features/trading/events/positionEvents";
import { createSseDataStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseDataStream({
	name: "positions",
	getCurrentData: getCurrentPositions,
	subscribe: subscribeToPositionEvents,
	getCacheMetadata: getPositionCacheMetadata,
	hydrateApiPath: "/api/positions?hydrate=sse",
});

export const Route = createFileRoute("/api/events/positions")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
