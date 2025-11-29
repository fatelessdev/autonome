import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
	createDashboardSseUpdaters,
	DASHBOARD_QUERIES,
} from "@/core/shared/trading/dashboardQueries";
import type {
	Conversation,
	ModelOption,
	ModelPositions,
	Trade,
	TradingDashboardData,
} from "./types";
import { resolveModelIdentity } from "./utils";

type UseTradingDashboardDataOptions = {
	enabled?: boolean;
};

const SSE_STREAMS = [
	{ type: "trades", url: "/api/events/trades", updater: "trades" },
	{ type: "positions", url: "/api/events/positions", updater: "positions" },
	{
		type: "conversations",
		url: "/api/events/conversations",
		updater: "conversations",
	},
] as const;

export function useTradingDashboardData({
	enabled = true,
}: UseTradingDashboardDataOptions = {}): TradingDashboardData {
	const queryClient = useQueryClient();
	const sseUpdaters = useMemo(
		() => createDashboardSseUpdaters(queryClient),
		[queryClient],
	);

	const tradesQuery = useQuery({
		...DASHBOARD_QUERIES.trades(),
		enabled,
	});
	const positionsQuery = useQuery({
		...DASHBOARD_QUERIES.positions(),
		enabled,
	});
	const conversationsQuery = useQuery({
		...DASHBOARD_QUERIES.conversations(),
		enabled,
	});

	useEffect(() => {
		if (!enabled) {
			return () => undefined;
		}

		const sources = SSE_STREAMS.map((stream) => {
			const source = new EventSource(stream.url);

			source.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data);
					sseUpdaters[stream.updater](payload);
				} catch (error) {
					console.error(`[SSE][${stream.type}] Failed to parse payload`, error);
				}
			};

			source.onerror = (error) => {
				console.error(`[SSE][${stream.type}] stream error`, error);
			};

			return source;
		});

		return () => {
			sources.forEach((source) => source.close());
		};
	}, [enabled, sseUpdaters]);

	const trades = tradesQuery.data ?? [];
	const positions = positionsQuery.data ?? [];
	const conversations = conversationsQuery.data ?? [];

	const modelOptions = useMemo(
		() => buildModelOptions(trades, positions, conversations),
		[trades, positions, conversations],
	);

	const loading =
		enabled &&
		(tradesQuery.isPending ||
			positionsQuery.isPending ||
			conversationsQuery.isPending);

	return {
		trades,
		positions,
		conversations,
		modelOptions,
		loading,
	};
}

function buildModelOptions(
	trades: Trade[],
	positions: ModelPositions[],
	conversations: Conversation[],
): ModelOption[] {
	const map = new Map<string, ModelOption>();

	const register = (
		modelId: string,
		identity: {
			modelKey?: string | null;
			modelName?: string | null;
			modelLogo?: string | null;
			modelRouterName?: string | null;
		},
	) => {
		if (!modelId) return;
		const normalizedId = modelId.trim().toLowerCase();
		if (!normalizedId) return;

		const info = resolveModelIdentity(identity);
		const existing = map.get(normalizedId);

		map.set(normalizedId, {
			id: modelId,
			label:
				info.label || existing?.label || identity.modelName || modelId,
			logo: info.logo || existing?.logo || "",
			color: info.color || existing?.color || "#888888",
		});
	};

	for (const trade of trades) {
		register(trade.modelId, {
			modelKey: trade.modelKey,
			modelName: trade.modelName,
			modelRouterName: trade.modelRouterName,
		});
	}

	for (const conversation of conversations) {
		register(conversation.modelId, {
			modelLogo: conversation.modelLogo,
			modelName: conversation.modelName,
		});
	}

	for (const group of positions) {
		register(group.modelId, {
			modelLogo: group.modelLogo,
			modelName: group.modelName,
		});
	}

	return Array.from(map.values());
}
