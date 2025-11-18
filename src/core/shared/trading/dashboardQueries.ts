import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { orpc } from "@/server/orpc/client";
import { normalizeNumber } from "@/shared/formatting/numberFormat";

import type {
	Conversation,
	ModelPositions,
	Position,
	PositionExitPlan,
	Trade,
	TradeSide,
} from "./dashboardTypes";

const BASE_REFRESH_MS = 5 * 60 * 1000;

export const DASHBOARD_ENDPOINTS = {
	trades: "/api/trades",
	positions: "/api/positions",
	conversations: "/api/invocations",
} as const;

export const DASHBOARD_QUERY_KEYS = {
	trades: () => ["dashboard", "trades"] as const,
	positions: () => ["dashboard", "positions"] as const,
	conversations: () => ["dashboard", "conversations"] as const,
} as const;

type TradesResponse = { trades?: unknown };
type PositionsResponse = { positions?: unknown };
type ConversationsResponse = { conversations?: unknown };

type Normalizer<TInput, TOutput> = (payload: TInput) => TOutput;

async function requestDashboardResource<TResponse, TResult>(
	endpoint: string,
	normalizer: Normalizer<TResponse, TResult>,
): Promise<TResult> {
	let payload: TResponse;
	
	switch (endpoint) {
		case DASHBOARD_ENDPOINTS.trades:
			const tradesData = await orpc.trading.getTrades.call({});
			payload = { trades: tradesData.trades } as TResponse;
			break;
		case DASHBOARD_ENDPOINTS.positions:
			const positionsData = await orpc.trading.getPositions.call({});
			payload = { positions: positionsData.positions } as TResponse;
			break;
		case DASHBOARD_ENDPOINTS.conversations:
			const conversationsData = await orpc.models.getInvocations.call({});
			// Transform the data to match the expected schema
			const transformedConversations = conversationsData.conversations.map(conv => ({
				id: conv.id,
				modelId: conv.modelId,
				modelName: conv.modelName || "Unknown Model",
				modelLogo: conv.modelLogo || "unknown-model",
				response: conv.response || "",
				timestamp: conv.timestamp,
				toolCalls: conv.toolCalls || []
			}));
			payload = { conversations: transformedConversations } as TResponse;
			break;
		default:
			throw new Error(`Unknown endpoint: ${endpoint}`);
	}
	
	return normalizer(payload);
}

function normalizeTradeSide(side: unknown): TradeSide {
	if (typeof side !== "string") return "UNKNOWN";
	const normalized = side.toUpperCase();
	return normalized === "LONG" || normalized === "SHORT"
		? normalized
		: "UNKNOWN";
}

function normalizeTrades(payload: TradesResponse): Trade[] {
	const raw = Array.isArray(payload.trades) ? payload.trades : [];
	return raw
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
			const record = entry as Record<string, unknown>;
			const id = typeof record.id === "string" ? record.id : typeof record.tradeId === "string" ? record.tradeId : null;
			const modelId =
				typeof record.modelId === "string"
					? record.modelId
					: typeof record.modelKey === "string"
						? record.modelKey
						: typeof id === "string"
						? id
						: null;

			if (!id || !modelId) return null;

			return {
				id,
				modelId,
				modelName: typeof record.modelName === "string" ? record.modelName : "",
				modelRouterName:
					typeof record.modelRouterName === "string"
						? record.modelRouterName
						: "",
				modelKey:
					typeof record.modelKey === "string" ? record.modelKey : modelId,
				symbol: typeof record.symbol === "string" ? record.symbol : "",
				side: normalizeTradeSide(record.side),
				quantity: normalizeNumber(record.quantity),
				entryPrice: normalizeNumber(record.entryPrice),
				exitPrice: normalizeNumber(record.exitPrice),
				entryNotional: normalizeNumber(record.entryNotional),
				exitNotional: normalizeNumber(record.exitNotional),
				netPnl: normalizeNumber(record.netPnl),
				openedAt: typeof record.openedAt === "string" ? record.openedAt : null,
				closedAt:
					typeof record.closedAt === "string"
						? record.closedAt
						: new Date().toISOString(),
				holdingTime:
					typeof record.holdingTime === "string" ? record.holdingTime : null,
				timestamp:
					typeof record.timestamp === "string" ? record.timestamp : null,
			} as Trade;
		})
		.filter((trade): trade is Trade => Boolean(trade));
}

function normalizeExitPlan(plan: unknown): PositionExitPlan | null {
	if (!plan || typeof plan !== "object") return null;
	const record = plan as Record<string, unknown>;
	const target = normalizeNumber(record.target);
	const stop = normalizeNumber(record.stop);
	const invalidation =
		typeof record.invalidation === "string" ? record.invalidation : null;

	if (target == null && stop == null && invalidation == null) {
		return null;
	}

	return { target, stop, invalidation };
}

function normalizePosition(entry: unknown): Position | null {
	if (!entry || typeof entry !== "object") return null;
	const record = entry as Record<string, unknown>;
	const symbol =
		typeof record.symbol === "string"
			? record.symbol
			: typeof record.position === "string"
				? record.position
				: null;

	if (!symbol) return null;

	const rawSign =
		typeof record.sign === "string" ? record.sign.toUpperCase() : "LONG";
	const sign = rawSign === "SHORT" ? "SHORT" : "LONG";

	return {
		symbol,
		position: typeof record.position === "string" ? record.position : symbol,
		sign,
		quantity: normalizeNumber(record.quantity),
		unrealizedPnl:
			typeof record.unrealizedPnl === "string" ? record.unrealizedPnl : "0",
		realizedPnl:
			typeof record.realizedPnl === "string" ? record.realizedPnl : "0",
		liquidationPrice:
			typeof record.liquidationPrice === "string"
				? record.liquidationPrice
				: "0",
		leverage:
			typeof record.leverage === "number" && Number.isFinite(record.leverage)
				? record.leverage
				: undefined,
		notional: typeof record.notional === "string" ? record.notional : undefined,
		exitPlan: normalizeExitPlan(record.exitPlan),
		confidence: normalizeNumber(record.confidence),
		signal:
			typeof record.signal === "string" &&
			["LONG", "SHORT", "HOLD"].includes(record.signal.toUpperCase())
				? (record.signal.toUpperCase() as Position["signal"])
				: "HOLD",
		lastDecisionAt:
			typeof record.lastDecisionAt === "string" ? record.lastDecisionAt : null,
		decisionStatus:
			typeof record.decisionStatus === "string" ? record.decisionStatus : null,
	};
}

function normalizePositions(payload: PositionsResponse): ModelPositions[] {
	const raw = Array.isArray(payload.positions) ? payload.positions : [];
	return raw
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
			const record = entry as Record<string, unknown>;
			const modelId =
				typeof record.modelId === "string" ? record.modelId :
				typeof record.modelKey === "string" ? record.modelKey : null;
			const modelName =
				typeof record.modelName === "string" ? record.modelName :
				typeof record.name === "string" ? record.name : modelId;
			
			if (!modelId || !modelName) return null;

			const positionsRaw = Array.isArray(record.positions)
				? record.positions
				: [];
			const positions = positionsRaw
				.map((position) => normalizePosition(position))
				.filter((pos): pos is Position => Boolean(pos));

			return {
				modelId,
				modelName,
				modelLogo:
					typeof record.modelLogo === "string" ? record.modelLogo : modelName,
				positions,
				totalUnrealizedPnl:
					typeof record.totalUnrealizedPnl === "number"
						? record.totalUnrealizedPnl
						: undefined,
				availableCash:
					typeof record.availableCash === "number" ? record.availableCash : undefined,
			} as ModelPositions;
		})
		.filter((group): group is ModelPositions => group !== null);
}

type ConversationMetadata = {
	raw: unknown;
	decisions: unknown;
	results: unknown;
};

function normalizeConversations(
	payload: ConversationsResponse,
): Conversation[] {
	const raw = Array.isArray(payload.conversations) ? payload.conversations : [];
	return raw
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
			const record = entry as Record<string, unknown>;
			const id = typeof record.id === "string" ? record.id : null;
			const modelId =
				typeof record.modelId === "string" ? record.modelId : null;
			if (!id || !modelId) return null;

			const toolCallsRaw = Array.isArray(record.toolCalls)
				? record.toolCalls
				: [];
			const toolCalls = toolCallsRaw
				.map((toolCall) => {
					if (!toolCall || typeof toolCall !== "object") return null;
					const tc = toolCall as Record<string, unknown>;
					const toolCallId = typeof tc.id === "string" ? tc.id : null;
					const type = typeof tc.type === "string" ? tc.type : null;
					if (!toolCallId || !type) return null;

					const metadata =
						typeof tc.metadata === "object" && tc.metadata != null
							? (tc.metadata as ConversationMetadata)
							: { raw: tc.metadata, decisions: [], results: [] };

					return {
						id: toolCallId,
						type,
						metadata: {
							raw: "raw" in metadata ? metadata.raw : tc.metadata,
							decisions: Array.isArray(metadata.decisions)
								? metadata.decisions
								: [],
							results: Array.isArray(metadata.results) ? metadata.results : [],
						},
						timestamp:
							typeof tc.timestamp === "string"
								? tc.timestamp
								: new Date().toISOString(),
					};
				})
				.filter((toolCall): toolCall is Conversation["toolCalls"][number] =>
					Boolean(toolCall),
				);

			return {
				id,
				modelId,
				modelName:
					typeof record.modelName === "string" ? record.modelName : "Unknown",
				modelLogo:
					typeof record.modelLogo === "string"
						? record.modelLogo
						: "unknown-model",
				response: typeof record.response === "string" ? record.response : "",
				timestamp:
					typeof record.timestamp === "string"
						? record.timestamp
						: new Date().toISOString(),
				toolCalls,
			} as Conversation;
		})
		.filter((conversation): conversation is Conversation =>
			Boolean(conversation),
		);
}

function coerceTradesResponse(payload: unknown): TradesResponse {
	if (payload && typeof payload === "object" && "trades" in payload) {
		return payload as TradesResponse;
	}

	return Array.isArray(payload) ? { trades: payload } : { trades: [] };
}

function coercePositionsResponse(payload: unknown): PositionsResponse {
	if (payload && typeof payload === "object" && "positions" in payload) {
		return payload as PositionsResponse;
	}

	return Array.isArray(payload) ? { positions: payload } : { positions: [] };
}

function coerceConversationsResponse(payload: unknown): ConversationsResponse {
	if (payload && typeof payload === "object" && "conversations" in payload) {
		return payload as ConversationsResponse;
	}

	return Array.isArray(payload)
		? { conversations: payload }
		: { conversations: [] };
}

export const DASHBOARD_NORMALIZERS = {
	trades: (payload: unknown) => normalizeTrades(coerceTradesResponse(payload)),
	positions: (payload: unknown) =>
		normalizePositions(coercePositionsResponse(payload)),
	conversations: (payload: unknown) =>
		normalizeConversations(coerceConversationsResponse(payload)),
} as const;

export const tradesQueryOptions = () =>
	queryOptions({
		queryKey: DASHBOARD_QUERY_KEYS.trades(),
		queryFn: () =>
			requestDashboardResource<TradesResponse, Trade[]>(
				DASHBOARD_ENDPOINTS.trades,
				normalizeTrades,
			),
		staleTime: BASE_REFRESH_MS / 2,
		gcTime: BASE_REFRESH_MS * 2,
		refetchInterval: BASE_REFRESH_MS,
	});

export const positionsQueryOptions = () =>
	queryOptions({
		queryKey: DASHBOARD_QUERY_KEYS.positions(),
		queryFn: () =>
			requestDashboardResource<PositionsResponse, ModelPositions[]>(
				DASHBOARD_ENDPOINTS.positions,
				normalizePositions,
			),
		staleTime: BASE_REFRESH_MS / 2,
		gcTime: BASE_REFRESH_MS * 2,
		refetchInterval: BASE_REFRESH_MS,
	});

export const conversationsQueryOptions = () =>
	queryOptions({
		queryKey: DASHBOARD_QUERY_KEYS.conversations(),
		queryFn: () =>
			requestDashboardResource<ConversationsResponse, Conversation[]>(
				DASHBOARD_ENDPOINTS.conversations,
				normalizeConversations,
			),
		staleTime: BASE_REFRESH_MS / 2,
		gcTime: BASE_REFRESH_MS * 2,
		refetchInterval: BASE_REFRESH_MS,
	});

export const DASHBOARD_QUERIES = {
	trades: tradesQueryOptions,
	positions: positionsQueryOptions,
	conversations: conversationsQueryOptions,
} as const;

export type DashboardSseUpdaters = ReturnType<
	typeof createDashboardSseUpdaters
>;

export function createDashboardSseUpdaters(queryClient: QueryClient) {
	return {
		trades: (payload: unknown) => {
			const normalized = DASHBOARD_NORMALIZERS.trades(payload);
			queryClient.setQueryData(DASHBOARD_QUERY_KEYS.trades(), normalized);
			return normalized;
		},
		positions: (payload: unknown) => {
			const normalized = DASHBOARD_NORMALIZERS.positions(payload);
			queryClient.setQueryData(DASHBOARD_QUERY_KEYS.positions(), normalized);
			return normalized;
		},
		conversations: (payload: unknown) => {
			const normalized = DASHBOARD_NORMALIZERS.conversations(payload);
			queryClient.setQueryData(
				DASHBOARD_QUERY_KEYS.conversations(),
				normalized,
			);
			return normalized;
		},
	};
}
