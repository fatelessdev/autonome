import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createSseConnection } from "@/core/lib/sseConnection";
import { getSseUrl } from "@/core/shared/api/apiConfig";
import { normalizeIdentifier } from "@/core/shared/strings/normalizeIdentifier";
import type { DashboardSseEvent } from "@/core/shared/trading/dashboardEvents";
import {
	DASHBOARD_QUERIES,
	DASHBOARD_QUERY_KEYS,
} from "@/server/orpc/dashboardQueries";
import type { VariantIdWithAll } from "../variant-provider";
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
	variant?: VariantIdWithAll;
};

export function useTradingDashboardData({
	enabled = true,
	variant = "all",
}: UseTradingDashboardDataOptions = {}): TradingDashboardData {
	const queryClient = useQueryClient();

	const tradesQuery = useQuery({
		...DASHBOARD_QUERIES.trades(variant),
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

		return createSseConnection({
			url: getSseUrl("/api/events/dashboard"),
			onMessage: (event) => {
				try {
					const payload = JSON.parse(event.data) as DashboardSseEvent;

					if (payload.type === "trades:changed") {
						void queryClient.invalidateQueries({
							queryKey: ["dashboard", "trades"],
						});
						return;
					}

					if (payload.type === "positions:changed") {
						void queryClient.invalidateQueries({
							queryKey: DASHBOARD_QUERY_KEYS.positions(),
						});
						return;
					}

					if (payload.type === "conversations:changed") {
						void queryClient.invalidateQueries({
							queryKey: DASHBOARD_QUERY_KEYS.conversations(),
						});
					}
				} catch (error) {
					console.error("[SSE][dashboard] Failed to parse payload", error);
				}
			},
		});
	}, [enabled, queryClient]);

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
		modelVariant?: Trade["modelVariant"],
	) => {
		if (!modelId) return;
		const info = resolveModelIdentity(identity);
		const label = info.label || identity.modelName || modelId;
		const normalizedLabel = normalizeIdentifier(label);
		if (!normalizedLabel) return;

		const existing = map.get(normalizedLabel);
		const matchers = new Set(existing?.matchers ?? []);
		[
			modelId,
			label,
			identity.modelName,
			identity.modelKey,
			identity.modelRouterName,
		]
			.filter((candidate): candidate is string => Boolean(candidate))
			.forEach((candidate) => {
				const normalized = normalizeIdentifier(candidate);
				if (normalized) {
					matchers.add(normalized);
				}
			});

		const variants = new Set(existing?.variants ?? []);
		if (modelVariant) {
			variants.add(modelVariant);
		}

		map.set(normalizedLabel, {
			id: normalizedLabel,
			label,
			logo: info.logo || existing?.logo || "",
			color: info.color || existing?.color || "#888888",
			matchers: Array.from(matchers),
			variants: Array.from(variants),
		});
	};

	for (const trade of trades) {
		register(
			trade.modelId,
			{
				modelKey: trade.modelKey,
				modelName: trade.modelName,
				modelRouterName: trade.modelRouterName,
			},
			trade.modelVariant,
		);
	}

	for (const conversation of conversations) {
		register(
			conversation.modelId,
			{
				modelLogo: conversation.modelLogo,
				modelName: conversation.modelName,
			},
			conversation.modelVariant,
		);
	}

	for (const group of positions) {
		register(
			group.modelId,
			{
				modelLogo: group.modelLogo,
				modelName: group.modelName,
			},
			group.modelVariant,
		);
	}

	return Array.from(map.values());
}
