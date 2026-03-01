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
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	invalidationPrice: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
	confidence: number | null;
}

export interface InvocationExecutionResultSummary {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
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
	/** DB order ID for adjustment tracking */
	orderId?: string;
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

type InvocationResultShape = {
	finishReason?: unknown;
	usage?: unknown;
	warnings?: unknown;
	response?: {
		id?: unknown;
		modelId?: unknown;
		timestamp?: unknown;
	};
};

const toInvocationResultShape = (
	result: unknown,
): InvocationResultShape | null => {
	if (result == null) {
		return null;
	}
	if (typeof result !== "object" || Array.isArray(result)) {
		throw new Error(
			`Invalid invocation result payload shape: expected object, received ${typeof result}`,
		);
	}
	return result as InvocationResultShape;
};

export function buildInvocationResponsePayload({
	prompt,
	result,
	decisions,
	executionResults,
	closedPositions,
	stepTelemetry,
}: {
	prompt: string;
	result: unknown | null;
	decisions: InvocationDecisionSummary[];
	executionResults: InvocationExecutionResultSummary[];
	closedPositions: InvocationClosedPositionSummary[];
	stepTelemetry?: StepTelemetry[];
}): InvocationResponsePayload {
	const base = toInvocationResultShape(result);

	const provider = base?.response;
	let timestamp: string | null = null;
	if (provider?.timestamp instanceof Date) {
		timestamp = provider.timestamp.toISOString();
	} else if (typeof provider?.timestamp === "string") {
		timestamp = provider.timestamp;
	}

	// Aggregate step telemetry
	const totalSteps = stepTelemetry?.length;
	const totalInputTokens = stepTelemetry?.reduce(
		(acc, s) => acc + s.inputTokens,
		0,
	);
	const totalOutputTokens = stepTelemetry?.reduce(
		(acc, s) => acc + s.outputTokens,
		0,
	);

	return {
		prompt,
		decisions,
		executionResults,
		closedPositions,
		finishReason: base?.finishReason ?? null,
		usage: base?.usage ?? null,
		warnings: base?.warnings ?? null,
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
