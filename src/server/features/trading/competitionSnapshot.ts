import { getLeaderboardData } from "@/server/features/analytics";
import type { LeaderboardEntry, LeaderboardWindow } from "@/server/features/analytics";

export interface CompetitionSnapshot {
	standings: string;
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

export async function buildCompetitionSnapshot(params: {
	modelId: string;
	variant?: string;
	window?: LeaderboardWindow;
}): Promise<CompetitionSnapshot> {
	const { modelId, variant, window = "7d" } = params;
	const rawEntries = await getLeaderboardData(window, variant);
	const entries = [...rawEntries].sort((a, b) => b.pnlPercent - a.pnlPercent);

	const leader = entries[0];
	const selfIndex = entries.findIndex((e) => e.modelId === modelId);
	const self = selfIndex >= 0 ? entries[selfIndex] : null;

	const standings = formatStandings(entries, modelId);

	if (!leader || !self) {
		return {
			standings,
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
		pnlDeltaToLeader,
		rank: selfIndex + 1,
		leaderPnlPercent: leader.pnlPercent,
		selfPnlPercent: self.pnlPercent,
		window,
	};
}
