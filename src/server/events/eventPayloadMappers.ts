/**
 * Payload mapper re-exports.
 *
 * The canonical payload mappers live next to the event types they produce:
 *   src/server/features/trading/events/eventPayloadMappers.ts
 *
 * This barrel re-exports them for consumers that prefer a top-level import path.
 */
export {
	mapPositionToEventData,
	mapTradeToEventData,
	mapConversationToEventData,
} from "@/server/features/trading/events/eventPayloadMappers";
