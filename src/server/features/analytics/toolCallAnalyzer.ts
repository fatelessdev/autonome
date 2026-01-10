import { generateText } from "ai";
import { incrementModelUsage } from "@/server/db/tradingRepository";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@/env";
import { mistral } from "@ai-sdk/mistral";

interface InvocationAnalysisInput {
	modelId: string;
	invocationId: string;
	responseText: string;
	isError?: boolean;
	toolCalls?: Array<{
		toolName?: string;
		error?: unknown;
		metadata?: unknown;
	}>;
	decisions?: Array<{
		symbol: string;
		side: string;
		quantity: number;
	}>;
	closedPositions?: Array<{
		symbol: string;
	}>;
}

/**
 * Analyzes an invocation to detect if the model intended to call a tool but failed to do so.
 * 
 * APPROACH: Deterministic checks first, LLM only for clear intent mismatch.
 * 
 * Deterministic NOT-a-failure cases:
 * 1. Schema validation errors (e.g., "reason too long") - model tried, tool rejected
 * 2. Any successful tool call executed - action was taken
 * 3. Holding tool was called - explicit no-action is valid
 * 4. Error invocation with tool calls - workflow aborted mid-execution
 * 
 * LLM-checked failure case (lenient):
 * - Model explicitly states "I am executing X trade now" with specific coin and direction,
 *   but no matching tool call exists and no holding was called.
 * 
 * Returns true if a failed tool call was detected.
 */
export async function analyzeToolCallFailure(
	input: InvocationAnalysisInput,
): Promise<boolean> {
	const {
		modelId,
		invocationId,
		responseText,
		isError,
		toolCalls,
		decisions,
		closedPositions,
	} = input;

	// === DETERMINISTIC CHECKS (fast path - no LLM needed) ===

	// Rule 1: If invocation errored and there's any tool call, NOT a failure
	// The workflow was aborted, not the model's fault
	if (isError && toolCalls && toolCalls.length > 0) {
		return false;
	}

	// Rule 2: If there's no response text, nothing to analyze
	if (!responseText || responseText.trim().length === 0) {
		return false;
	}

	// Rule 3: Check for schema validation errors in tool calls
	// These are NOT failures - the model tried to call the tool but it was rejected
	const hasSchemaError = toolCalls?.some((tc) => {
		if (!tc.error) return false;
		const errorStr = String(tc.error).toLowerCase();
		return (
			errorStr.includes("too_big") ||
			errorStr.includes("string must contain at most") ||
			errorStr.includes("maximum") ||
			errorStr.includes("validation") ||
			errorStr.includes("schema") ||
			errorStr.includes("invalid")
		);
	});
	if (hasSchemaError) {
		console.log(
			`[ToolCallAnalyzer] Schema validation error detected for ${modelId} - not counting as failed intent`,
		);
		return false;
	}

	// Rule 4: If holding tool was called successfully, NOT a failure
	// Holding is a valid explicit decision to not trade
	const hasHoldingCall = toolCalls?.some(
		(tc) => tc.toolName === "holding" && !tc.error,
	);
	if (hasHoldingCall) {
		return false;
	}

	// Rule 5: If any position was successfully created or closed, NOT a failure
	// The model successfully executed its intent
	const hasSuccessfulTrade =
		(decisions && decisions.length > 0) ||
		(closedPositions && closedPositions.length > 0);
	if (hasSuccessfulTrade) {
		return false;
	}

	// Rule 6: If updateExitPlan was called successfully, NOT a failure
	const hasExitPlanUpdate = toolCalls?.some(
		(tc) => tc.toolName === "updateExitPlan" && !tc.error,
	);
	if (hasExitPlanUpdate) {
		return false;
	}

	// Rule 7: If any tool was called (even with error), the model tried to act
	// We already handled schema errors above, so remaining errors are execution errors
	const hasAnyToolCall = toolCalls && toolCalls.length > 0;
	if (hasAnyToolCall) {
		return false;
	}

	// === LLM CHECK (only for "I said I'd trade but called nothing" case) ===
	// This is a lenient check - only flag clear explicit intent statements

	try {
		const analysisPrompt = `You are analyzing a trading AI's response to detect a SPECIFIC failure pattern:
The model explicitly stated it was executing a trade (e.g., "Opening long BTC", "Shorting ETH now") 
but NO tool calls were made at all.

Model's response:
"""
${responseText.slice(0, 2000)}
"""

Tool calls made: NONE (no createPosition, closePosition, updateExitPlan, or holding calls)

Is this a CLEAR CASE of the model stating it's executing a specific trade but failing to call any tool?

BE LENIENT - only answer YES if:
- The model explicitly says it IS opening/closing a position (not "considering" or "would")
- The statement is a clear action declaration, not analysis or recommendation
- There's no indication the model changed its mind or said "holding" later

Answer YES or NO:`;
		const nim = createOpenAICompatible({
			name: "nim",
			baseURL: "https://integrate.api.nvidia.com/v1",
			headers: {
				Authorization: `Bearer ${env.NIM_API_KEY}`,
			},
		});

		const result = await generateText({
			model: mistral('codestral-latest') as any,
			prompt: analysisPrompt,
			temperature: 0,
		});

		const answer = result.text.trim().toUpperCase();
		const isFailedToolCall = answer === "YES";

		if (isFailedToolCall) {
			console.warn(
				`[ToolCallAnalyzer] Detected failed tool call intent for model ${modelId} invocation ${invocationId}`,
			);

			// Increment the failed tool call counter
			await incrementModelUsage(modelId, {
				failedToolCallCountDelta: 1,
			});
		}

		return isFailedToolCall;
	} catch (error) {
		console.error("[ToolCallAnalyzer] Analysis failed:", error);
		return false;
	}
}
