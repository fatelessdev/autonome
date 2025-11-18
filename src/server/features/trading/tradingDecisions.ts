export type TradingSignal = "LONG" | "SHORT" | "HOLD";

export interface TradingDecision {
	symbol: string;
	signal: TradingSignal;
	quantity: number | null;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	confidence: number | null;
	status?: string | null;
}

export interface TradingDecisionResult {
	symbol: string;
	success: boolean;
	error?: string | null;
}

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

const SIGNAL_LOOKUP: Record<string, TradingSignal> = {
	LONG: "LONG",
	SHORT: "SHORT",
	HOLD: "HOLD",
};

const toNumber = (value: unknown): number | null => {
	if (value == null) return null;
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
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
	return str.toUpperCase();
};

const normalizeSignal = (value: unknown): TradingSignal | null => {
	const str = toStringValue(value);
	if (!str) return null;
	const upper = str.toUpperCase();
	if (upper in SIGNAL_LOOKUP) {
		return SIGNAL_LOOKUP[upper];
	}
	return null;
};

const parseDecisionCandidate = (
	value: unknown,
	fallbackSymbol?: string,
): TradingDecision | null => {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;

	const symbol = normalizeSymbol(
		record.symbol ?? record.market ?? fallbackSymbol,
	);
	if (!symbol) return null;

	const signal = normalizeSignal(record.signal ?? record.side ?? record.action);
	if (!signal) return null;

	const quantity = toNumber(
		record.quantity ?? record.size ?? record.notional ?? record.amount,
	);
	const leverage = toNumber(record.leverage ?? record.leverageRatio);
	const profitTarget = toNumber(
		record.profitTarget ?? record.target ?? record.profit_target,
	);
	const stopLoss = toNumber(record.stopLoss ?? record.stop ?? record.stop_loss);
	const invalidationCondition =
		toStringValue(
			record.invalidationCondition ??
				record.invalidCondition ??
				record.invalid_condition ??
				record.invalidation_condition,
		) ?? null;
	const confidence = toNumber(
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
		signal,
		quantity,
		leverage,
		profitTarget,
		stopLoss,
		invalidationCondition,
		confidence,
		status,
	};
};

const parseResultCandidate = (
	value: unknown,
	fallbackSymbol?: string,
): TradingDecisionResult | null => {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;

	const symbol = normalizeSymbol(record.symbol ?? fallbackSymbol);
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
		return { decisions: [], results: [], raw };
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
		const parsed = parseTradingToolCallMetadata(toolCall.metadata);
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
