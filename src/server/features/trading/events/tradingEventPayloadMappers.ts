/**
 * Event Payload Mappers
 *
 * Pure functions that convert raw DB query results into typed SSE event payloads.
 * Both the API server (SSE hydration on connect) and workflowEvents (post-trade
 * fanout) use identical mapping logic — these functions eliminate that duplication.
 */

import type { ConversationEventData } from "./conversationEvents";
import type { PositionEventData } from "./positionEvents";
import type { TradeEventData } from "./tradeEvents";

// -----------------------------------------------------------------------
// Input shapes — structural types matching DB query return values.
// Defined locally to avoid a tight import dependency on queries.server.
// -----------------------------------------------------------------------

type PositionQueryItem = {
	modelId: string;
	modelName: string;
	modelLogo?: string | null;
	positions: unknown[];
	totalUnrealizedPnl: number;
};

type TradeQueryItem = {
	id: string;
	modelId: string;
	modelName: string;
	modelRouterName?: string | null;
	symbol: string;
	side: string;
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	netPnl: number | null;
	openedAt: string | null;
	closedAt: string | null;
	holdingTime: string | null;
	timestamp: string | null;
};

type ConversationQueryItem = {
	id: string;
	modelId: string;
	modelName: string;
	modelLogo: string;
	response: string | null;
	responsePayload: unknown;
	timestamp: string;
	toolCalls: ConversationEventData["toolCalls"];
};

// -----------------------------------------------------------------------
// Mappers
// -----------------------------------------------------------------------

export function mapPositionToEventData(
	p: PositionQueryItem,
): PositionEventData {
	if (typeof p.modelLogo !== "string" || p.modelLogo.length === 0) {
		throw new Error(`Missing modelLogo for position event model ${p.modelId}`);
	}

	return {
		modelId: p.modelId,
		modelName: p.modelName,
		modelLogo: p.modelLogo,
		positions: p.positions,
		totalUnrealizedPnl: p.totalUnrealizedPnl,
	};
}

export function mapTradeToEventData(t: TradeQueryItem): TradeEventData {
	if (typeof t.modelRouterName !== "string" || t.modelRouterName.length === 0) {
		throw new Error(
			`Missing modelRouterName for trade event ${t.id} (model ${t.modelId})`,
		);
	}
	if (t.side !== "LONG" && t.side !== "SHORT") {
		throw new Error(`Invalid trade side for event ${t.id}: ${t.side}`);
	}

	const entryNotional =
		t.quantity != null && t.entryPrice != null
			? t.quantity * t.entryPrice
			: null;
	const exitNotional =
		t.quantity != null && t.exitPrice != null ? t.quantity * t.exitPrice : null;

	return {
		id: t.id,
		modelId: t.modelId,
		modelName: t.modelName,
		modelRouterName: t.modelRouterName,
		symbol: t.symbol,
		side: t.side,
		quantity: t.quantity,
		entryPrice: t.entryPrice,
		exitPrice: t.exitPrice,
		entryNotional,
		exitNotional,
		netPnl: t.netPnl,
		openedAt: t.openedAt,
		closedAt: t.closedAt,
		holdingTime: t.holdingTime,
		timestamp: t.timestamp,
	};
}

export function mapConversationToEventData(
	c: ConversationQueryItem,
): ConversationEventData {
	return {
		id: c.id,
		modelId: c.modelId,
		modelName: c.modelName,
		modelLogo: c.modelLogo,
		response: c.response,
		responsePayload: c.responsePayload,
		timestamp: c.timestamp,
		toolCalls: c.toolCalls,
	};
}
