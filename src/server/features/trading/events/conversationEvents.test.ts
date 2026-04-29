import { describe, it, expect } from "vitest";
import { emitConversationEvent, subscribeToConversationEvents, getCurrentConversations, getConversationCacheMetadata } from "./conversationEvents";

describe("conversationEvents", () => {
	it("exports expected members", () => {
		expect(emitConversationEvent).toBeDefined();
		expect(subscribeToConversationEvents).toBeDefined();
		expect(getCurrentConversations).toBeDefined();
		expect(getConversationCacheMetadata).toBeDefined();
	});
});
