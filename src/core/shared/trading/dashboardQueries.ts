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

type VariantFilter = Trade["modelVariant"] | "all" | undefined;

export const DASHBOARD_QUERY_KEYS = {
	trades: (variant?: VariantFilter) =>
		["dashboard", "trades", variant ?? "all"] as const,
	positions: () => ["dashboard", "positions"] as const,
	conversations: () => ["dashboard", "conversations"] as const,
} as const;

type TradesResponse = { trades?: unknown };
type PositionsResponse = { positions?: unknown };
type ConversationsResponse = { conversations?: unknown };

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
			const id =
				typeof record.id === "string"
					? record.id
					: typeof record.tradeId === "string"
						? record.tradeId
						: null;
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
				modelVariant:
					typeof record.modelVariant === "string" &&
					["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian"].includes(record.modelVariant)
						? (record.modelVariant as "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian")
						: undefined,
				modelRouterName:
					typeof record.modelRouterName === "string"
						? record.modelRouterName
						: "",
				modelKey:
					typeof record.modelKey === "string" && record.modelKey.length > 0
						? record.modelKey
						: typeof record.modelRouterName === "string" && record.modelRouterName.length > 0
							? record.modelRouterName
							: modelId,
				symbol: typeof record.symbol === "string" ? record.symbol : "",
				side: normalizeTradeSide(record.side),
				quantity: normalizeNumber(record.quantity),
				entryPrice: normalizeNumber(record.entryPrice),
				exitPrice: normalizeNumber(record.exitPrice),
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
	const confidence = normalizeNumber(record.confidence);

	if (target == null && stop == null && invalidation == null && confidence == null) {
		return null;
	}

	return { target, stop, invalidation, confidence };
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
		typeof record.side === "string" ? record.side.toUpperCase() : "LONG";
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
				typeof record.modelId === "string"
					? record.modelId
					: typeof record.modelKey === "string"
						? record.modelKey
						: null;
			const modelName =
				typeof record.modelName === "string"
					? record.modelName
					: typeof record.name === "string"
						? record.name
						: modelId;

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
				modelVariant:
					typeof record.modelVariant === "string" &&
					["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian"].includes(record.modelVariant)
						? (record.modelVariant as "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian")
						: undefined,
				modelLogo:
					typeof record.modelLogo === "string" ? record.modelLogo : modelName,
				positions,
				totalUnrealizedPnl:
					typeof record.totalUnrealizedPnl === "number"
						? record.totalUnrealizedPnl
						: undefined,
				availableCash:
					typeof record.availableCash === "number"
						? record.availableCash
						: undefined,
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
			const responsePayload =
				record.responsePayload && typeof record.responsePayload === "object"
					? (record.responsePayload as Record<string, unknown>)
					: null;
			const prompt =
				typeof responsePayload?.prompt === "string"
					? responsePayload.prompt
					: null;

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
				modelVariant:
					typeof record.modelVariant === "string" &&
					["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian"].includes(record.modelVariant)
						? (record.modelVariant as "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian")
						: undefined,
				modelLogo:
					typeof record.modelLogo === "string"
						? record.modelLogo
						: "unknown-model",
				response: typeof record.response === "string" ? record.response : "",
				prompt,
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

async function fetchTrades(variant?: VariantFilter): Promise<Trade[]> {
	const data = await orpc.trading.getTrades.call({
		limit: 100,
		variant: variant && variant !== "all" ? variant : undefined,
	});
	return normalizeTrades({ trades: data.trades });
}

async function fetchPositions(): Promise<ModelPositions[]> {
	const data = await orpc.trading.getPositions.call({});
	return normalizePositions({ positions: data.positions });
}

async function fetchConversations(): Promise<Conversation[]> {
	const data = await orpc.models.getInvocations.call({});
	const transformed = data.conversations.map((conv) => ({
		id: conv.id,
		modelId: conv.modelId,
		modelName: conv.modelName || "Unknown Model",
		modelVariant: conv.modelVariant || undefined,
		modelLogo: conv.modelLogo || "unknown-model",
		response: conv.response || "",
		timestamp: conv.timestamp,
		toolCalls: conv.toolCalls || [],
	}));
	return normalizeConversations({ conversations: transformed });
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

export type DashboardSseUpdaters = ReturnType<
	typeof createDashboardSseUpdaters
>;

export function createDashboardSseUpdaters(queryClient: QueryClient) {
	const isTradesKey = (
		queryKey: unknown,
	): queryKey is ReturnType<(typeof DASHBOARD_QUERY_KEYS)["trades"]> =>
		Array.isArray(queryKey) &&
		queryKey[0] === "dashboard" &&
		queryKey[1] === "trades";

	return {
		trades: (payload: unknown) => {
			const normalized = DASHBOARD_NORMALIZERS.trades(payload);
			queryClient.setQueryData(
				DASHBOARD_QUERY_KEYS.trades("all"),
				normalized,
			);
			queryClient.invalidateQueries({
				predicate: ({ queryKey }) =>
					isTradesKey(queryKey) && (queryKey[2] as VariantFilter) !== "all",
			});
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
