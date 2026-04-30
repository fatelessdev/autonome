import { describe, expect, it } from "vitest";
import {
	emitConversationEvent,
	getConversationCacheMetadata,
	getCurrentConversations,
	subscribeToConversationEvents,
} from "./conversationEvents";

describe("conversationEvents", () => {
	it("exports expected members", () => {
		expect(emitConversationEvent).toBeDefined();
		expect(subscribeToConversationEvents).toBeDefined();
		expect(getCurrentConversations).toBeDefined();
		expect(getConversationCacheMetadata).toBeDefined();
	});
});
