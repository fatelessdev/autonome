import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
	createDashboardSseUpdaters,
	DASHBOARD_QUERIES,
} from "@/core/shared/trading/dashboardQueries";
import { getModelInfo } from "@/shared/models/modelConfig";
import type {
	Conversation,
	ModelOption,
	ModelPositions,
	Trade,
	TradingDashboardData,
} from "./types";

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

	const register = (id?: string, fallbackName?: string) => {
		if (!id) return;
		const info = getModelInfo(id);
		const existing = map.get(id);
		const logo = info.logo || existing?.logo || "";
		const color = info.logo ? info.color : (existing?.color ?? info.color);
		const label = info.logo
			? info.label
			: existing?.label && existing.label !== existing.id
				? existing.label
				: (fallbackName ?? info.label ?? id);

		map.set(id, { id, label, logo, color });
	};

	trades.forEach((trade) => register(trade.modelKey, trade.modelName));
	conversations.forEach((conversation) =>
		register(
			conversation.modelLogo || conversation.modelName,
			conversation.modelName,
		),
	);
	positions.forEach((group) =>
		register(group.modelLogo || group.modelName, group.modelName),
	);

	return Array.from(map.values());
}
