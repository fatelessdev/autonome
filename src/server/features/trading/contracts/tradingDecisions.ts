import { normalizeNumber } from "@/core/shared/formatting/numberFormat";
import { toCanonical } from "@/core/shared/markets/marketMetadata";
import type {
	TradingDecision,
	TradingDecisionResult,
	TradingSide,
} from "@/core/shared/trading/tradingDecisionTypes";

// Re-export shared types for backward compatibility
export type {
	TradingDecision,
	TradingDecisionResult,
} from "@/core/shared/trading/tradingDecisionTypes";

export interface TradingToolCallMetadata {
	decisions: TradingDecision[];
	results: TradingDecisionResult[];
	raw: unknown;
}

export interface ToolCallDecisionSource {
	id: string;
	createdAt: Date;
	metadata: unknown;
	toolCallType?: string;
}

export interface TradingDecisionWithContext extends TradingDecision {
	toolCallId: string;
	createdAt: Date;
	toolCallType?: string;
	result?: TradingDecisionResult | null;
}

const SIGNAL_LOOKUP: Record<string, TradingSide> = {
	LONG: "LONG",
	SHORT: "SHORT",
	HOLD: "HOLD",
};

const toStringValue = (value: unknown): string | null => {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value.toString();
	}
	return null;
};

const normalizeSymbol = (value: unknown): string | null => {
	const str = toStringValue(value);
	if (!str) return null;
	return toCanonical(str).toUpperCase();
};

const normalizeSignal = (value: unknown): TradingSide | null => {
	const str = toStringValue(value);
	if (!str) return null;
	const upper = str.toUpperCase();
	if (upper in SIGNAL_LOOKUP) {
		return SIGNAL_LOOKUP[upper];
	}
	return null;
};

const parseDecisionCandidate = (value: unknown): TradingDecision | null => {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;

	const symbol = normalizeSymbol(record.symbol ?? record.market);
	if (!symbol) return null;

	const side = normalizeSignal(record.signal ?? record.side ?? record.action);
	if (!side) return null;

	// Only accept explicit base-asset size fields, NOT notional/amount (which may be USD)
	const quantity = normalizeNumber(
		record.quantity ?? record.size ?? record.baseAmount,
	);
	const profitTarget = normalizeNumber(
		record.profitTarget ?? record.target ?? record.profit_target,
	);
	const stopLoss = normalizeNumber(
		record.stopLoss ?? record.stop ?? record.stop_loss,
	);
	const invalidationCondition =
		toStringValue(
			record.invalidationCondition ??
				record.invalidCondition ??
				record.invalid_condition ??
				record.invalidation_condition,
		) ?? null;
	const invalidationPrice = normalizeNumber(
		record.invalidationPrice ?? record.invalidation_price,
	);
	const timeExit = toStringValue(record.timeExit ?? record.time_exit) ?? null;
	const cooldownUntil =
		toStringValue(record.cooldownUntil ?? record.cooldown_until) ?? null;
	const confidence = normalizeNumber(
		record.confidence ??
			record.confidenceScore ??
			record.confidence_percent ??
			record.confidence_percentage,
	);
	const status =
		toStringValue(
			record.status ?? record.executionStatus ?? record.execution_status,
		) ?? null;

	return {
		symbol,
		side,
		quantity,
		profitTarget,
		stopLoss,
		invalidationCondition,
		invalidationPrice,
		timeExit,
		cooldownUntil,
		confidence,
		status,
	};
};

const parseResultCandidate = (value: unknown): TradingDecisionResult | null => {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;

	const symbol = normalizeSymbol(record.symbol);
	if (!symbol) return null;

	const successValue = record.success ?? record.ok ?? record.executed;
	const success =
		typeof successValue === "boolean"
			? successValue
			: successValue === 1 || successValue === "true";
	const error =
		toStringValue(record.error ?? record.reason ?? record.message) ?? null;

	return { symbol, success, error };
};

const collectDecisionArrays = (raw: Record<string, unknown>): unknown[] => {
	const collections: unknown[] = [];
	const candidateKeys = [
		"decisions",
		"updates",
		"positions",
		"actions",
		"entries",
		"closedPositions",
		"signals",
	];

	for (const key of candidateKeys) {
		const value = raw[key];
		if (Array.isArray(value)) {
			collections.push(value);
		}
	}

	return collections;
};

const collectResultArrays = (raw: Record<string, unknown>): unknown[] => {
	const collections: unknown[] = [];
	const candidateKeys = [
		"results",
		"executions",
		"outcomes",
		"closedPositions",
	];

	for (const key of candidateKeys) {
		const value = raw[key];
		if (Array.isArray(value)) {
			collections.push(value);
		}
	}

	return collections;
};

export const parseTradingToolCallMetadata = (
	raw: unknown,
): TradingToolCallMetadata => {
	if (typeof raw !== "object" || raw === null) {
		throw new Error(
			`Invalid trading tool metadata shape: expected object, received ${typeof raw}`,
		);
	}

	const record = raw as Record<string, unknown>;
	const decisions: TradingDecision[] = [];

	for (const collection of collectDecisionArrays(record)) {
		if (!Array.isArray(collection)) continue;
		for (const item of collection) {
			const decision = parseDecisionCandidate(item);
			if (decision) {
				decisions.push(decision);
			}
		}
	}

	if (decisions.length === 0) {
		const fallbackDecision = parseDecisionCandidate(record);
		if (fallbackDecision) {
			decisions.push(fallbackDecision);
		}
	}

	if (decisions.length === 0) {
		throw new Error("No valid trading decisions found in tool call metadata");
	}

	const results: TradingDecisionResult[] = [];
	for (const collection of collectResultArrays(record)) {
		if (!Array.isArray(collection)) continue;
		for (const item of collection) {
			const result = parseResultCandidate(item);
			if (result) {
				results.push(result);
			}
		}
	}

	return { decisions, results, raw };
};

export const buildDecisionIndex = (
	toolCalls: ToolCallDecisionSource[],
): Map<string, TradingDecisionWithContext> => {
	const index = new Map<string, TradingDecisionWithContext>();

	for (const toolCall of toolCalls) {
		let parsed: TradingToolCallMetadata;
		try {
			parsed = parseTradingToolCallMetadata(toolCall.metadata);
		} catch (error) {
			console.warn(
				`[DecisionIndex] Skipping malformed tool call ${toolCall.id}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			continue;
		}
		if (!parsed.decisions.length) continue;

		const resultLookup = new Map<string, TradingDecisionResult>();
		for (const result of parsed.results) {
			resultLookup.set(result.symbol, result);
		}

		for (const decision of parsed.decisions) {
			const key = decision.symbol;
			if (!key || index.has(key)) {
				continue;
			}

			index.set(key, {
				...decision,
				toolCallId: toolCall.id,
				createdAt: toolCall.createdAt,
				toolCallType: toolCall.toolCallType,
				result: resultLookup.get(key) ?? null,
			});
		}
	}

	return index;
};
