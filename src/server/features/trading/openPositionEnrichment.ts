import type {
	ExitPlanSummary,
	OpenPositionSummary,
} from "@/server/features/trading/openPositions";
import type {
	TradingDecisionWithContext,
	TradingSignal,
} from "@/server/features/trading/tradingDecisions";

export interface EnrichedOpenPosition extends OpenPositionSummary {
	exitPlan: ExitPlanSummary | null;
	confidence: number | null;
	signal: TradingSignal | null;
	lastDecisionAt: string | null;
	decisionStatus: string | null;
	notionalUsd: number | null;
	riskUsd: number | null;
	riskPercent: number | null;
	rewardUsd: number | null;
	rewardPercent: number | null;
	riskRewardRatio: number | null;
}

export function toNumeric(
	value: number | string | null | undefined,
): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export const resolveQuantity = (
	position: OpenPositionSummary,
): number | null => {
	if (
		typeof position.quantity === "number" &&
		Number.isFinite(position.quantity)
	) {
		return Math.abs(position.quantity);
	}

	if (typeof position.position === "string") {
		const parsed = Number.parseFloat(position.position);
		if (Number.isFinite(parsed)) {
			return Math.abs(parsed);
		}
	}

	return null;
};

export const resolveNotionalUsd = (
	position: OpenPositionSummary,
): number | null => {
	const candidate = (position as { notional?: unknown }).notional;
	if (typeof candidate === "number" || typeof candidate === "string") {
		const notionalValue = toNumeric(candidate);
		if (notionalValue !== null) {
			return Math.abs(notionalValue);
		}
	}

	const quantity = resolveQuantity(position);
	const referencePriceCandidate =
		position.entryPrice ??
		position.markPrice ??
		position.liquidationPrice ??
		null;
	const referencePrice = toNumeric(referencePriceCandidate);

	if (quantity !== null && referencePrice !== null) {
		return Math.abs(quantity * referencePrice);
	}

	return null;
};

const mergeExitPlans = (
	decision: TradingDecisionWithContext | undefined,
	fallback: ExitPlanSummary | null | undefined,
): ExitPlanSummary | null => {
	const target = decision?.profitTarget ?? fallback?.target ?? null;
	const stop = decision?.stopLoss ?? fallback?.stop ?? null;
	const invalidation =
		decision?.invalidationCondition ?? fallback?.invalidation ?? null;

	if (target === null && stop === null && invalidation === null) {
		return null;
	}

	return { target, stop, invalidation };
};

export const computeRiskMetrics = (
	position: OpenPositionSummary,
	exitPlan: ExitPlanSummary | null,
	notionalUsd: number | null,
) => {
	const quantity = resolveQuantity(position);
	const entryPrice = position.entryPrice ?? position.markPrice ?? null;
	const stop = exitPlan?.stop ?? null;
	const target = exitPlan?.target ?? null;

	let riskUsd: number | null = null;
	let riskPercent: number | null = null;
	if (quantity !== null && entryPrice !== null && stop !== null) {
		const diff =
			position.sign === "LONG" ? entryPrice - stop : stop - entryPrice;
		if (diff > 0) {
			riskUsd = diff * quantity;
			if (notionalUsd && notionalUsd > 0) {
				riskPercent = (riskUsd / notionalUsd) * 100;
			}
		}
	}

	let rewardUsd: number | null = null;
	let rewardPercent: number | null = null;
	if (quantity !== null && entryPrice !== null && target !== null) {
		const diff =
			position.sign === "LONG" ? target - entryPrice : entryPrice - target;
		if (diff > 0) {
			rewardUsd = diff * quantity;
			if (notionalUsd && notionalUsd > 0) {
				rewardPercent = (rewardUsd / notionalUsd) * 100;
			}
		}
	}

	const riskRewardRatio =
		riskUsd !== null && rewardUsd !== null && riskUsd > 0
			? rewardUsd / riskUsd
			: null;

	return { riskUsd, riskPercent, rewardUsd, rewardPercent, riskRewardRatio };
};

const resolveDecisionStatus = (
	decision: TradingDecisionWithContext | undefined,
): string | null => {
	if (!decision) return null;
	if (decision.status) return decision.status;
	if (decision.result?.success === true) return "FILLED";
	if (decision.result?.success === false) return "REJECTED";
	return null;
};

export const enrichOpenPositions = (
	positions: OpenPositionSummary[],
	decisionIndex: Map<string, TradingDecisionWithContext>,
): EnrichedOpenPosition[] => {
	return positions.map((position) => {
		const symbolKey = position.symbol?.toUpperCase?.() ?? position.symbol;
		const decision = symbolKey ? decisionIndex.get(symbolKey) : undefined;
		const exitPlan = mergeExitPlans(decision, position.exitPlan ?? null);
		const notionalUsd = resolveNotionalUsd(position);
		const { riskUsd, riskPercent, rewardUsd, rewardPercent, riskRewardRatio } =
			computeRiskMetrics(position, exitPlan, notionalUsd);

		return {
			...position,
			exitPlan,
			confidence: decision?.confidence ?? position.confidence ?? null,
			signal: decision?.signal ?? position.signal ?? position.sign,
			lastDecisionAt:
				decision?.createdAt?.toISOString?.() ?? position.lastDecisionAt ?? null,
			decisionStatus:
				resolveDecisionStatus(decision) ?? position.decisionStatus ?? null,
			notionalUsd,
			riskUsd,
			riskPercent,
			rewardUsd,
			rewardPercent,
			riskRewardRatio,
		} satisfies EnrichedOpenPosition;
	});
};

export const summarizePositionRisk = (positions: EnrichedOpenPosition[]) => {
	return positions.reduce(
		(acc, position) => {
			const quantity =
				resolveQuantity(position) ?? Math.abs(position.quantity ?? 0);
			const notional =
				position.notionalUsd ??
				(position.entryPrice != null && quantity > 0
					? Math.abs(position.entryPrice * quantity)
					: null) ??
				(position.markPrice != null && quantity > 0
					? Math.abs(position.markPrice * quantity)
					: null);

			const unrealized = toNumeric(position.unrealizedPnl) ?? 0;
			const realized = toNumeric(position.realizedPnl) ?? 0;

			if (notional != null) {
				acc.totalNotional += notional;
				if (position.sign === "LONG") {
					acc.longExposure += notional;
				} else {
					acc.shortExposure += notional;
				}
			}

			acc.totalUnrealized += unrealized;
			acc.totalRealized += realized;
			if (position.riskUsd != null) {
				const risk = Math.max(position.riskUsd, 0);
				acc.totalRiskUsd += risk;
				acc.maxPositionRiskUsd = Math.max(acc.maxPositionRiskUsd, risk);
			}
			return acc;
		},
		{
			totalNotional: 0,
			longExposure: 0,
			shortExposure: 0,
			totalUnrealized: 0,
			totalRealized: 0,
			totalRiskUsd: 0,
			maxPositionRiskUsd: 0,
		},
	);
};

export type ExposureSummary = ReturnType<typeof summarizePositionRisk>;
