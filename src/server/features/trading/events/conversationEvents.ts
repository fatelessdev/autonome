import { createTypedEventBus } from "@/server/events/typedEventBus";

export type ConversationEventData = {
	id: string;
	modelId: string;
	modelName: string;
	modelLogo: string;
	response: string | null;
	responsePayload: unknown;
	timestamp: string;
	toolCalls: Array<{
		id: string;
		type: string;
		metadata: {
			raw: unknown;
			decisions: unknown;
			results: unknown;
		};
		timestamp: string;
	}>;
};

export type ConversationEvent = {
	type: "conversations:updated";
	timestamp: string;
	data: ConversationEventData[];
};

const bus = createTypedEventBus<ConversationEvent>("conversation-update");

let currentConversationsCache: ConversationEventData[] = [];
let lastConversationUpdateAt: number | null = null;

export const emitConversationEvent = (event: ConversationEvent): void => {
	currentConversationsCache = event.data;
	lastConversationUpdateAt = Date.now();
	bus.emit(event);
};

export const subscribeToConversationEvents = bus.subscribe;

export const getCurrentConversations = (): ConversationEventData[] =>
	currentConversationsCache;

export const getConversationCacheMetadata = () => ({
	count: currentConversationsCache.length,
	lastUpdatedAt: lastConversationUpdateAt,
});
