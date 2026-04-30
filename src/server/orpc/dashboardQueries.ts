import { queryOptions } from "@tanstack/react-query";
import { isValidVariantId } from "@/core/shared/variants";
import { orpc } from "@/server/orpc/client";
import { normalizeNumber } from "@/core/shared/formatting/numberFormat";
import { toCanonical } from "@/core/shared/markets/marketMetadata";

import type {
	Conversation,
	ModelPositions,
	Position,
	PositionExitPlan,
	Trade,
} from "@/core/shared/trading/dashboardTypes";

const BASE_REFRESH_MS = 5 * 60 * 1000;

type VariantFilter = Trade["modelVariant"] | "all" | undefined;

export const DASHBOARD_QUERY_KEYS = {
	trades: (variant?: VariantFilter) =>
		["dashboard", "trades", variant ?? "all"] as const,
	positions: () => ["dashboard", "positions"] as const,
	conversations: () => ["dashboard", "conversations"] as const,
} as const;

function toTrade(
	trade: Awaited<
		ReturnType<typeof orpc.trading.getTrades.call>
	>["trades"][number],
): Trade {
	return {
		id: trade.id,
		modelId: trade.modelId,
		modelName: trade.modelName,
		modelVariant:
			typeof trade.modelVariant === "string" &&
			isValidVariantId(trade.modelVariant)
				? trade.modelVariant
				: undefined,
		modelRouterName: trade.modelRouterName ?? "",
		modelKey: trade.modelKey ?? trade.modelRouterName ?? trade.modelId,
		symbol: toCanonical(trade.symbol),
		side: trade.side === "short" ? "SHORT" : "LONG",
		quantity: normalizeNumber(trade.quantity),
		entryPrice: normalizeNumber(trade.entryPrice),
		exitPrice: normalizeNumber(trade.exitPrice),
		netPnl: normalizeNumber(trade.netPnl),
		openedAt: trade.openedAt,
		closedAt: trade.closedAt,
		holdingTime: trade.holdingTime ?? null,
		timestamp: trade.timestamp,
	};
}

function toExitPlan(
	exitPlan:
		| {
				target?: number | null;
				stop?: number | null;
				invalidation?: string | null;
		  }
		| undefined,
): PositionExitPlan | null {
	if (!exitPlan) return null;

	return {
		target: normalizeNumber(exitPlan.target),
		stop: normalizeNumber(exitPlan.stop),
		invalidation: exitPlan.invalidation ?? null,
	};
}

function toPosition(
	position: Awaited<
		ReturnType<typeof orpc.trading.getPositions.call>
	>["positions"][number]["positions"][number],
): Position {
	const symbol = toCanonical(position.symbol);
	const normalizedNotional = normalizeNumber(position.notional);

	return {
		symbol,
		position: symbol,
		side: position.side === "short" ? "SHORT" : "LONG",
		quantity: normalizeNumber(position.quantity),
		entryPrice: normalizeNumber(position.entryPrice),
		currentPrice: normalizeNumber(position.currentPrice),
		unrealizedPnl: normalizeNumber(position.unrealizedPnl) ?? 0,
		realizedPnl: 0,
		liquidationPrice: "0",
		notional:
			normalizedNotional != null ? String(normalizedNotional) : undefined,
		exitPlan: toExitPlan(position.exitPlan),
		confidence: normalizeNumber(position.confidence),
		lastDecisionAt: position.lastDecisionAt ?? null,
		decisionStatus: position.decisionStatus ?? null,
	};
}

function toModelPositions(
	group: Awaited<
		ReturnType<typeof orpc.trading.getPositions.call>
	>["positions"][number],
): ModelPositions {
	return {
		modelId: group.modelId,
		modelName: group.modelName,
		modelVariant:
			typeof group.modelVariant === "string" &&
			isValidVariantId(group.modelVariant)
				? group.modelVariant
				: undefined,
		modelLogo: group.modelLogo ?? group.modelName,
		positions: group.positions.map(toPosition),
		totalUnrealizedPnl: normalizeNumber(group.totalUnrealizedPnl) ?? undefined,
	};
}

function toConversation(
	conversation: Awaited<
		ReturnType<typeof orpc.models.getInvocations.call>
	>["conversations"][number],
): Conversation {
	return {
		id: conversation.id,
		modelId: conversation.modelId,
		modelName: conversation.modelName,
		modelVariant:
			typeof conversation.modelVariant === "string" &&
			isValidVariantId(conversation.modelVariant)
				? conversation.modelVariant
				: undefined,
		modelLogo: conversation.modelLogo,
		response: conversation.response ?? "",
		prompt:
			typeof conversation.responsePayload?.prompt === "string"
				? conversation.responsePayload.prompt
				: null,
		timestamp: conversation.timestamp,
		toolCalls: conversation.toolCalls.map((toolCall) => ({
			id: toolCall.id,
			type: toolCall.type,
			metadata: {
				raw: toolCall.metadata.raw,
				decisions: toolCall.metadata.decisions,
				results: toolCall.metadata.results,
			},
			timestamp: toolCall.timestamp,
		})),
	};
}

async function fetchTrades(variant?: VariantFilter): Promise<Trade[]> {
	const data = await orpc.trading.getTrades.call({
		limit: 100,
		variant: variant && variant !== "all" ? variant : undefined,
	});

	return data.trades.map(toTrade);
}

async function fetchPositions(): Promise<ModelPositions[]> {
	const data = await orpc.trading.getPositions.call({});
	return data.positions.map(toModelPositions);
}

async function fetchConversations(): Promise<Conversation[]> {
	const data = await orpc.models.getInvocations.call({});
	return data.conversations.map(toConversation);
}

export const tradesQueryOptions = (variant?: VariantFilter) =>
	queryOptions({
		queryKey: DASHBOARD_QUERY_KEYS.trades(variant),
		queryFn: () => fetchTrades(variant),
		staleTime: BASE_REFRESH_MS / 2,
		gcTime: BASE_REFRESH_MS * 2,
		refetchInterval: BASE_REFRESH_MS,
	});

export const positionsQueryOptions = () =>
	queryOptions({
		queryKey: DASHBOARD_QUERY_KEYS.positions(),
		queryFn: fetchPositions,
		staleTime: BASE_REFRESH_MS / 2,
		gcTime: BASE_REFRESH_MS * 2,
		refetchInterval: BASE_REFRESH_MS,
	});

export const conversationsQueryOptions = () =>
	queryOptions({
		queryKey: DASHBOARD_QUERY_KEYS.conversations(),
		queryFn: fetchConversations,
		staleTime: BASE_REFRESH_MS / 2,
		gcTime: BASE_REFRESH_MS * 2,
		refetchInterval: BASE_REFRESH_MS,
	});

export const DASHBOARD_QUERIES = {
	trades: tradesQueryOptions,
	positions: positionsQueryOptions,
	conversations: conversationsQueryOptions,
} as const;
