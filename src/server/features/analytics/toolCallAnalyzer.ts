import { generateText } from "ai";
import { incrementModelUsage } from "@/server/db/tradingRepository";
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
 * Uses Codestral to analyze the response text and metadata.
 *
 * Failure cases:
 * 1. Model says "opening {coin}" but called holding tool (no metadata) or opened wrong coin
 *    - NOT a fail if model mentions BTC and opens SOL too (opens both)
 *    - IS a fail if model mentions BTC only but opens SOL only
 * 2. Model says "holding" explicitly but opens or closes something (updateExitPlan is OK)
 * 3. NOT a fail if model doesn't mention creating/closing/updating but does any of them
 * 4. NOT a fail if invocation is an error (workflow aborted) and there's any tool call
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

	// Rule 4: If invocation errored and there's any tool call, NOT a failure
	if (isError && toolCalls && toolCalls.length > 0) {
		return false;
	}

	if (!responseText || responseText.trim().length === 0) {
		return false;
	}

	// Use Codestral to analyze the specific failure cases
	try {
		const openedSymbols = decisions?.map((d) => d.symbol.toUpperCase()) ?? [];
		const closedSymbols = closedPositions?.map((p) => p.symbol.toUpperCase()) ?? [];
		const hasUpdateExitPlan = toolCalls?.some((t) => t.toolName === "updateExitPlan") ?? false;
		const hasOpenOrClose = (decisions?.length ?? 0) > 0 || (closedPositions?.length ?? 0) > 0;

		const analysisPrompt = `You are analyzing a trading AI's response to detect SPECIFIC failure patterns.

Model's response:
"""
${responseText.slice(0, 2000)}
"""

Actions taken:
- Opened positions: ${openedSymbols.length > 0 ? openedSymbols.join(", ") : "none"}
- Closed positions: ${closedSymbols.length > 0 ? closedSymbols.join(", ") : "none"}
- Updated exit plan: ${hasUpdateExitPlan ? "yes" : "no"}
- Any open/close action: ${hasOpenOrClose ? "yes" : "no"}

Determine if this is a FAILED TOOL CALL based on these EXACT rules:

1. FAIL: Model says "opening {COIN}" or similar intent to open a specific coin, but:
   - Called holding tool (no actual open) OR
   - Opened a DIFFERENT coin only (not the mentioned one)
   - NOT a fail if model mentions BTC and opens both BTC and SOL
   - IS a fail if model says "opening BTC" but only opens SOL

2. FAIL: Model explicitly says "holding" or "no trades" or "staying out" but actually opened or closed a position
   - updateExitPlan is OK when saying holding (not a fail)

3. NOT A FAIL: Model doesn't mention any intent to create/close/update positions but still does any action
   - If model just analyzes market and happens to trade, that's fine

Respond with ONLY "YES" or "NO":
- YES = This matches one of the FAIL patterns above
- NO = This does not match any fail pattern

Answer:`;

		const result = await generateText({
			model: mistral("codestral-latest"),
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
