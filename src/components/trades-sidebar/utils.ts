import { formatIstTimestamp } from "@/shared/formatting/dateFormat";
import {
	formatConfidenceValue,
	formatLeverageValue,
	formatPriceLabel,
	formatQuantityValue,
} from "@/shared/formatting/numberFormat";
import { getModelInfo } from "@/shared/models/modelConfig";
import type { Conversation, TradingDecisionCard } from "./types";

export const extractMarkdownPreview = (
	markdown: string | undefined,
	limit = 220,
) => {
	if (!markdown) return "";
	const stripped = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/[*_>#-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (stripped.length <= limit) return stripped;
	return `${stripped.slice(0, limit)}…`;
};

export const extractTradingDecisions = (
	toolCalls: Conversation["toolCalls"],
): TradingDecisionCard[] => {
	const decisions: TradingDecisionCard[] = [];

	toolCalls.forEach((tc) => {
		const metadata = tc.metadata;
		const decisionList = [
			...(Array.isArray(metadata?.decisions) ? metadata.decisions : []),
			...(Array.isArray((metadata as any)?.updates)
				? ((metadata as any).updates as unknown[])
				: []),
		];
		const results = metadata?.results ?? [];
		const resultLookup = new Map<
			string,
			Conversation["toolCalls"][number]["metadata"]["results"][number]
		>();
		const rawMetadata = metadata?.raw as Record<string, unknown> | undefined;
		const rawActionValue =
			typeof rawMetadata?.action === "string" ? rawMetadata.action : null;
		const normalizedAction = (() => {
			if (rawActionValue === "updateExitPlan") return "UPDATE_EXIT_PLAN";
			if (tc.type === "CLOSE_POSITION") return "CLOSE_POSITION";
			if (tc.type === "CREATE_POSITION") return "CREATE_POSITION";
			if (typeof tc.type === "string" && tc.type.length > 0) return tc.type;
			return "OTHER";
		})();
		const isCloseCall = normalizedAction === "CLOSE_POSITION";
		const isUpdateCall = normalizedAction === "UPDATE_EXIT_PLAN";

		results.forEach((result) => {
			if (typeof result?.symbol === "string") {
				resultLookup.set(result.symbol.toUpperCase(), result);
			}
		});

		decisionList.forEach((decision, idx) => {
			if (!decision || typeof decision.symbol !== "string") return;
			const symbol = decision.symbol.toUpperCase();
			const normalizedSignal =
				decision.signal === "LONG" ||
				decision.signal === "SHORT" ||
				decision.signal === "HOLD"
					? decision.signal
					: "HOLD";
			const baseResult = resultLookup.get(symbol) ?? null;
			let effectiveResult = baseResult;
			if (isCloseCall) {
				if (effectiveResult) {
					if (effectiveResult.success === false && !effectiveResult.error) {
						effectiveResult = { ...effectiveResult, success: true };
					}
				} else {
					effectiveResult = { symbol, success: true };
				}
			}
			let status = decision.status ?? null;
			if (!status) {
				if (isCloseCall) {
					status =
						effectiveResult?.success === false && effectiveResult.error
							? "FAILED"
							: "CLOSED";
				} else if (isUpdateCall) {
					status = "UPDATED";
				} else if (effectiveResult?.success === true) {
					status = "EXECUTED";
				} else if (effectiveResult?.success === false) {
					status = "REJECTED";
				} else if (normalizedSignal === "HOLD") {
					status = "HOLD";
				}
			}

			const decisionReason =
				typeof (decision as { reason?: unknown })?.reason === "string"
					? ((decision as { reason: string }).reason || "").trim() || null
					: null;
			const fallbackReason =
				typeof rawMetadata?.reason === "string" &&
				rawMetadata.reason.trim().length > 0
					? rawMetadata.reason.trim()
					: null;

			decisions.push({
				key: `${tc.id}-${idx}`,
				symbol,
				signal: normalizedSignal,
				action: normalizedAction,
				quantity: decision.quantity ?? null,
				leverage: decision.leverage ?? null,
				profitTarget: decision.profitTarget ?? null,
				stopLoss: decision.stopLoss ?? null,
				invalidationCondition: decision.invalidationCondition ?? null,
				confidence: decision.confidence ?? null,
				toolCallType: tc.type,
				status,
				result: effectiveResult ?? null,
				timestamp: tc.timestamp,
				reason: decisionReason ?? fallbackReason,
			});
		});
	});

	return decisions;
};

export const formatDecisionDetails = (decision: TradingDecisionCard) => ({
	confidenceLabel: formatConfidenceValue(decision.confidence),
	quantityLabel: formatQuantityValue(decision.quantity),
	leverageLabel: formatLeverageValue(decision.leverage),
	targetLabel: formatPriceLabel(decision.profitTarget),
	stopLabel: formatPriceLabel(decision.stopLoss),
});

export const formatTimestamp = (timestamp: string | null) => {
	return formatIstTimestamp(timestamp);
};

export const computeHoldingLabel = (
	openedAt: string | null,
	closedAt: string,
) => {
	if (!openedAt) return "--";
	const openDate = new Date(openedAt);
	const closeDate = new Date(closedAt);
	const diff = closeDate.getTime() - openDate.getTime();
	if (!Number.isFinite(diff) || diff <= 0) return "<1M";

	const totalMinutes = Math.floor(diff / 60_000);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}D`);
	if (hours > 0) parts.push(`${hours}H`);
	parts.push(`${minutes}M`);
	return parts.join(" ");
};

type ModelIdentitySource = {
	modelKey?: string | null;
	modelName?: string | null;
	modelLogo?: string | null;
	modelRouterName?: string | null;
};

export const resolveModelIdentity = (source: ModelIdentitySource) => {
	const candidates = [
		source.modelLogo,
		source.modelKey,
		source.modelRouterName,
		source.modelName,
	]
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.map((value) => value.trim());

	for (const candidate of candidates) {
		const info = getModelInfo(candidate);
		if (info.logo) {
			return info;
		}
	}

	const fallbackLabel =
		source.modelName ||
		source.modelRouterName ||
		source.modelKey ||
		source.modelLogo ||
		"Unknown Model";

	if (candidates.length > 0) {
		const info = getModelInfo(candidates[0]);
		return {
			logo: info.logo,
			color: info.color,
			label: info.logo ? info.label : fallbackLabel,
		};
	}

	return {
		logo: "",
		color: "#888888",
		label: fallbackLabel,
	};
};
