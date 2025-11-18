import "@/polyfill";

import { createFileRoute } from "@tanstack/react-router";

import { subscribeToTradingEvents } from "@/server/features/trading/events/tradingEvents";
import { createSseEventStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseEventStream({
	name: "trading",
	subscribe: subscribeToTradingEvents,
	eventName: "trading-update",
	sendConnectedEvent: true,
});

export const Route = createFileRoute("/api/events/trading")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
