import { createFileRoute } from "@tanstack/react-router";
import {
	emitConversationEvent,
	getConversationCacheMetadata,
	getCurrentConversations,
	subscribeToConversationEvents,
	type ConversationEventData,
} from "@/server/features/trading/events/conversationEvents";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";
import { createSseDataStream } from "@/server/sse/sseStreamFactory";

const handleGet = createSseDataStream({
	name: "conversations",
	getCurrentData: getCurrentConversations,
	subscribe: subscribeToConversationEvents,
	getCacheMetadata: getConversationCacheMetadata,
	hydrate: async () => {
		const conversations = await refreshConversationEvents();
		emitConversationEvent({
			type: "conversations:updated",
			timestamp: new Date().toISOString(),
			data: conversations as ConversationEventData[],
		});
	},
});

export const Route = createFileRoute("/api/events/conversations")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
