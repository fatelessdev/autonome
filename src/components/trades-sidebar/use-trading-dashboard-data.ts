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

	const register = (modelId: string, modelName?: string, modelLogo?: string) => {
		if (!modelId) return;
		
		// Normalize the modelId to use as key
		const normalizedId = modelId.trim().toLowerCase();
		if (!normalizedId) return;
		
		// Try to get model info from the config
		const info = getModelInfo(modelId);
		const existing = map.get(normalizedId);
		
		// Prefer logo from config, then from existing, then from parameter
		const logo = info.logo || existing?.logo || modelLogo || "";
		// Color comes from config if logo exists, otherwise use existing or default
		const color = info.logo ? info.color : (existing?.color ?? info.color);
		// Label: prefer config label if logo exists, then existing label, then modelName, then modelId
		const label = info.logo
			? info.label
			: existing?.label && existing.label !== normalizedId
				? existing.label
				: (modelName || info.label || modelId);

		map.set(normalizedId, { id: modelId, label, logo, color });
	};

	// Register all unique models from trades (use modelId as primary key)
	trades.forEach((trade) => {
		register(trade.modelId, trade.modelName, trade.modelKey);
	});
	
	// Register from conversations
	conversations.forEach((conversation) => {
		register(conversation.modelId, conversation.modelName, conversation.modelLogo);
	});
	
	// Register from positions
	positions.forEach((group) => {
		register(group.modelId, group.modelName, group.modelLogo);
	});

	return Array.from(map.values());
}
