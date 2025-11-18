import { createFileRoute } from "@tanstack/react-router";
import {
	getConversationCacheMetadata,
	getCurrentConversations,
	subscribeToConversationEvents,
} from "@/server/features/trading/events/conversationEvents";
import { createSseDataStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseDataStream({
	name: "conversations",
	getCurrentData: getCurrentConversations,
	subscribe: subscribeToConversationEvents,
	getCacheMetadata: getConversationCacheMetadata,
	hydrateApiPath: "/api/invocations?hydrate=sse",
});

export const Route = createFileRoute("/api/events/conversations")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
