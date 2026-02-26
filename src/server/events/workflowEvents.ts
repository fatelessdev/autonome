/**
 * Trading Workflow Events
 *
 * Production-level event system for notifying clients when trading data changes.
 *
 * Architecture:
 * - Single SSE endpoint for all trading workflow events
 * - Events signal that data has changed, clients refetch via oRPC
 * - No data caching in the event layer - TanStack Query handles caching
 * - Simple, predictable event flow: workflow completes → emit event → clients refetch
 *
 * Event Types:
 * - workflow:complete - A single model's workflow finished (positions may have changed)
 * - batch:complete - All models finished their scheduled run
 * - positions:changed - Positions data has changed (create/close/update)
 * - trades:changed - Trades data has changed (position closed)
 * - conversations:changed - Conversations data has changed (new invocation)
 */

import { EventEmitter } from "node:events";
import { refreshConversationEvents } from "@/server/features/trading/data/conversationsSnapshot.server";
import {
	fetchPositions,
	fetchTrades,
} from "@/server/features/trading/data/tradingQueries.server";
import { emitConversationEvent } from "@/server/features/trading/events/conversationEvents";
import { emitPositionEvent } from "@/server/features/trading/events/positionEvents";
import { emitTradeEvent } from "@/server/features/trading/events/tradeEvents";
import {
	mapConversationToEventData,
	mapPositionToEventData,
	mapTradeToEventData,
} from "@/server/features/trading/events/tradingEventPayloadMappers";

// ============================================================================
// Event Types
// ============================================================================

export type WorkflowEventType =
	| "workflow:complete"
	| "batch:complete"
	| "positions:changed"
	| "trades:changed"
	| "conversations:changed"
	| "connected";

export interface BaseWorkflowEvent {
	type: WorkflowEventType;
	timestamp: string;
}

export interface WorkflowCompleteEvent extends BaseWorkflowEvent {
	type: "workflow:complete";
	modelId: string;
}

export interface BatchCompleteEvent extends BaseWorkflowEvent {
	type: "batch:complete";
	modelIds: string[];
}

export interface DataChangedEvent extends BaseWorkflowEvent {
	type: "positions:changed" | "trades:changed" | "conversations:changed";
	modelIds?: string[];
}

export interface ConnectedEvent extends BaseWorkflowEvent {
	type: "connected";
}

export type WorkflowEvent =
	| WorkflowCompleteEvent
	| BatchCompleteEvent
	| DataChangedEvent
	| ConnectedEvent;

// ============================================================================
// Event Emitter Singleton
// ============================================================================

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // Support many concurrent SSE connections

const EVENT_KEY = "workflow-event";

// ============================================================================
// Event Publishers
// ============================================================================

/**
 * Emit a workflow event to all connected clients
 */
export function emitWorkflowEvent(event: WorkflowEvent): void {
	emitter.emit(EVENT_KEY, event);
}

/**
 * Emit when a single model's workflow completes
 */
export function emitWorkflowComplete(modelId: string): void {
	emitWorkflowEvent({
		type: "workflow:complete",
		modelId,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Emit when all scheduled model workflows complete
 */
export function emitBatchComplete(modelIds: string[]): void {
	emitWorkflowEvent({
		type: "batch:complete",
		modelIds,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Emit when positions data has changed
 */
export function emitPositionsChanged(modelIds?: string[]): void {
	emitWorkflowEvent({
		type: "positions:changed",
		modelIds,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Emit when trades data has changed (positions closed)
 */
export function emitTradesChanged(modelIds?: string[]): void {
	emitWorkflowEvent({
		type: "trades:changed",
		modelIds,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Emit when conversations data has changed
 */
export function emitConversationsChanged(modelIds?: string[]): void {
	emitWorkflowEvent({
		type: "conversations:changed",
		modelIds,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Emit all data change events after a workflow completes
 * This is the main function to call after runTradeWorkflow
 * Also triggers the data SSE stream emitters for real-time updates
 */
export async function emitAllDataChanged(modelId: string): Promise<void> {
	const modelIds = [modelId];
	emitPositionsChanged(modelIds);
	emitTradesChanged(modelIds);
	emitConversationsChanged(modelIds);
	emitWorkflowComplete(modelId);

	const [positions, trades, conversations] = await Promise.all([
		fetchPositions(),
		fetchTrades(),
		refreshConversationEvents(),
	]);

	emitPositionEvent({
		type: "positions:updated",
		timestamp: new Date().toISOString(),
		data: positions.map(mapPositionToEventData),
	});

	emitTradeEvent({
		type: "trades:updated",
		timestamp: new Date().toISOString(),
		data: trades.map(mapTradeToEventData),
	});

	emitConversationEvent({
		type: "conversations:updated",
		timestamp: new Date().toISOString(),
		data: conversations.map(mapConversationToEventData),
	});
}

// ============================================================================
// Event Subscribers
// ============================================================================

export type WorkflowEventListener = (event: WorkflowEvent) => void;
export type Unsubscribe = () => void;

/**
 * Subscribe to all workflow events
 */
export function subscribeToWorkflowEvents(
	listener: WorkflowEventListener,
): Unsubscribe {
	emitter.on(EVENT_KEY, listener);
	return () => {
		emitter.off(EVENT_KEY, listener);
	};
}

/**
 * Get current listener count for debugging
 */
export function getListenerCount(): number {
	return emitter.listenerCount(EVENT_KEY);
}
