import type { GenerateTextResult } from "ai";

export interface InvocationDecisionSummary {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	confidence: number | null;
}

export interface InvocationExecutionResultSummary {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	success: boolean;
	error: string | null;
}

export interface InvocationClosedPositionSummary {
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	netPnl: number | null;
	realizedPnl: number | null;
	unrealizedPnl: number | null;
	closedAt: string | null;
}

export interface InvocationResponsePayload {
	prompt: string;
	decisions: InvocationDecisionSummary[];
	executionResults: InvocationExecutionResultSummary[];
	closedPositions: InvocationClosedPositionSummary[];
	finishReason: unknown;
	usage: unknown;
	warnings: unknown;
	providerResponse: {
		id: string | null;
		modelId: string | null;
		timestamp: string | null;
	} | null;
}

export function buildInvocationResponsePayload({
	prompt,
	result,
	decisions,
	executionResults,
	closedPositions,
}: {
	prompt: string;
	result: GenerateTextResult<any, any> | null;
	decisions: InvocationDecisionSummary[];
	executionResults: InvocationExecutionResultSummary[];
	closedPositions: InvocationClosedPositionSummary[];
}): InvocationResponsePayload {
	const base = (result ?? {}) as {
		finishReason?: unknown;
		usage?: unknown;
		warnings?: unknown;
		response?: {
			id?: unknown;
			modelId?: unknown;
			timestamp?: unknown;
		};
	};

	const provider = base.response;
	let timestamp: string | null = null;
	if (provider?.timestamp instanceof Date) {
		timestamp = provider.timestamp.toISOString();
	} else if (typeof provider?.timestamp === "string") {
		timestamp = provider.timestamp;
	}

	return {
		prompt,
		decisions,
		executionResults,
		closedPositions,
		finishReason: base.finishReason ?? null,
		usage: base.usage ?? null,
		warnings: base.warnings ?? null,
		providerResponse: provider
			? {
					id: typeof provider.id === "string" ? provider.id : null,
					modelId:
						typeof provider.modelId === "string" ? provider.modelId : null,
					timestamp,
				}
			: null,
	};
}
