import { EventEmitter } from "node:events";

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

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const EVENT_KEY = "conversation-update";

// Cache for current conversations
let currentConversationsCache: ConversationEventData[] = [];
let lastConversationUpdateAt: number | null = null;

export const emitConversationEvent = (event: ConversationEvent) => {
	currentConversationsCache = event.data;
	lastConversationUpdateAt = Date.now();
	emitter.emit(EVENT_KEY, event);
};

export const subscribeToConversationEvents = (
	listener: (event: ConversationEvent) => void,
) => {
	emitter.on(EVENT_KEY, listener);
	return () => {
		emitter.off(EVENT_KEY, listener);
	};
};

export const getCurrentConversations = () => {
	return currentConversationsCache;
};

export const getConversationCacheMetadata = () => {
	return {
		count: currentConversationsCache.length,
		lastUpdatedAt: lastConversationUpdateAt,
	};
};
