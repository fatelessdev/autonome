import type { GenerateTextResult } from "ai";

/**
 * Step-level telemetry captured during agent execution via onStepFinish.
 * Useful for debugging failures and analyzing cost/performance.
 */
export interface StepTelemetry {
	stepNumber: number;
	toolNames: string[];
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	timestamp: string;
}

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
	/** Step-level telemetry for debugging and cost analysis */
	stepTelemetry?: StepTelemetry[];
	/** Total steps executed before completion or failure */
	totalSteps?: number;
	/** Aggregated token usage across all steps */
	totalInputTokens?: number;
	totalOutputTokens?: number;
}

export function buildInvocationResponsePayload({
	prompt,
	result,
	decisions,
	executionResults,
	closedPositions,
	stepTelemetry,
}: {
	prompt: string;
	result: GenerateTextResult<any, any> | null;
	decisions: InvocationDecisionSummary[];
	executionResults: InvocationExecutionResultSummary[];
	closedPositions: InvocationClosedPositionSummary[];
	stepTelemetry?: StepTelemetry[];
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

	// Aggregate step telemetry
	const totalSteps = stepTelemetry?.length ?? 0;
	const totalInputTokens = stepTelemetry?.reduce((acc, s) => acc + s.inputTokens, 0) ?? 0;
	const totalOutputTokens = stepTelemetry?.reduce((acc, s) => acc + s.outputTokens, 0) ?? 0;

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
		stepTelemetry,
		totalSteps,
		totalInputTokens,
		totalOutputTokens,
	};
}
