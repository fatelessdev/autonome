import { getLeaderboardData } from "@/server/features/analytics";
import type { LeaderboardEntry, LeaderboardWindow } from "@/server/features/analytics";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { models, orders, OrderStatus } from "@/db/schema";
import type { VariantId } from "@/server/features/trading/prompts/variants";

export interface CompetitionSnapshot {
	standings: string;
	openPositionsSummary: string;
	pnlDeltaToLeader: string;
	rank: number | null;
	leaderPnlPercent: number | null;
	selfPnlPercent: number | null;
	window: LeaderboardWindow;
}

function formatPnlPercent(value: number): string {
	const sign = value > 0 ? "+" : value < 0 ? "" : "";
	return `${sign}${value.toFixed(2)}%`;
}

function formatStandings(entries: LeaderboardEntry[], modelId: string): string {
	if (entries.length === 0) return "No leaderboard data yet";

	const top = entries.slice(0, 5);
	const parts = top.map((entry, index) => {
		const rank = index + 1;
		const isSelf = entry.modelId === modelId;
		const label = `#${rank}`;
		const name = isSelf ? `${entry.modelName} (you)` : entry.modelName;
		return `${label} ${name} ${formatPnlPercent(entry.pnlPercent)}`;
	});

	const joined = parts.join(" | ");
	return joined.length > 260 ? `${joined.slice(0, 257)}...` : joined;
}

function formatOpenPositionsSummary(params: {
	topEntries: LeaderboardEntry[];
	ordersByModelId: Map<
		string,
		Array<{
			symbol: string;
			side: string;
			leverage: string | null;
		}>
	>;
}): string {
	const { topEntries, ordersByModelId } = params;
	if (topEntries.length === 0) return "No leaderboard data yet";

	const parts: string[] = [];
	for (const [index, entry] of topEntries.entries()) {
		const rank = index + 1;
		const positions = ordersByModelId.get(entry.modelId) ?? [];
		const positionsLabel =
			positions.length === 0
				? "flat"
				: positions
						.slice(0, 2)
						.map((p) => {
							const lev = p.leverage ? `${parseFloat(p.leverage).toFixed(1)}x` : "1.0x";
							return `${p.symbol} ${p.side} ${lev}`;
						})
						.join(", ");

		parts.push(`#${rank} ${entry.modelName}: ${positionsLabel}`);
	}

	const joined = parts.join(" | ");
	return joined.length > 380 ? `${joined.slice(0, 377)}...` : joined;
}

export async function buildCompetitionSnapshot(params: {
	modelId: string;
	variant?: VariantId;
	window?: LeaderboardWindow;
}): Promise<CompetitionSnapshot> {
	const { modelId, variant, window = "7d" } = params;
	const rawEntries = await getLeaderboardData(window, variant);
	const entries = [...rawEntries].sort((a, b) => b.pnlPercent - a.pnlPercent);

	const leader = entries[0];
	const selfIndex = entries.findIndex((e) => e.modelId === modelId);
	const self = selfIndex >= 0 ? entries[selfIndex] : null;

	const standings = formatStandings(entries, modelId);

	const topEntries = entries.slice(0, 5);
	const topModelIds = topEntries.map((e) => e.modelId);
	const openOrders =
		topModelIds.length === 0
			? []
			: await db
					.select({
						modelId: orders.modelId,
						symbol: orders.symbol,
						side: orders.side,
						leverage: orders.leverage,
					})
					.from(orders)
					.innerJoin(models, eq(models.id, orders.modelId))
					.where(
						and(
							inArray(orders.modelId, topModelIds),
							eq(orders.status, OrderStatus.OPEN),
						),
					)
					.orderBy(desc(orders.openedAt));

	const ordersByModelId = new Map<
		string,
		Array<{ symbol: string; side: string; leverage: string | null }>
	>();
	for (const order of openOrders) {
		const bucket = ordersByModelId.get(order.modelId) ?? [];
		bucket.push({
			symbol: order.symbol,
			side: order.side,
			leverage: order.leverage,
		});
		ordersByModelId.set(order.modelId, bucket);
	}

	const openPositionsSummary = formatOpenPositionsSummary({
		topEntries,
		ordersByModelId,
	});

	if (!leader || !self) {
		return {
			standings,
			openPositionsSummary,
			pnlDeltaToLeader: "N/A",
			rank: self ? selfIndex + 1 : null,
			leaderPnlPercent: leader?.pnlPercent ?? null,
			selfPnlPercent: self?.pnlPercent ?? null,
			window,
		};
	}

	const delta = leader.pnlPercent - self.pnlPercent;
	const pnlDeltaToLeader = selfIndex === 0
		? "You are leading"
		: `${delta.toFixed(2)}pp behind leader`;

	return {
		standings,
		openPositionsSummary,
		pnlDeltaToLeader,
		rank: selfIndex + 1,
		leaderPnlPercent: leader.pnlPercent,
		selfPnlPercent: self.pnlPercent,
		window,
	};
}
