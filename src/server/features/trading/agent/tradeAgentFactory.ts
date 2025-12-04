/**
 * Trade Agent Factory
 * Creates and configures the ToolLoopAgent for trading
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, ToolLoopAgent, stepCountIs, hasToolCall } from "ai";
import * as Sentry from "@sentry/react";

import { env } from "@/env";
import type { Account } from "@/server/features/trading/accounts";
import type { StepTelemetry } from "@/server/features/trading/invocationResponse";
import { getModelProvider } from "@/shared/models/modelConfig";

import { agentOutputSchema, callOptionsSchema } from "./schemas";
import { createTradingTools, type ToolContext } from "./tools";

/**
 * Configuration for creating a trade agent
 */
export interface TradeAgentConfig {
	/** Account/model to trade as */
	account: Account;
	/** System prompt for the agent */
	systemPrompt: string;
	/** Tool context for shared state */
	toolContext: ToolContext;
	/** Callback for capturing step telemetry */
	onStepTelemetry?: (telemetry: StepTelemetry) => void;
}

/**
 * Creates a configured ToolLoopAgent for trading
 */
export function createTradeAgent(config: TradeAgentConfig) {
	const { account, systemPrompt, toolContext, onStepTelemetry } = config;

	// Initialize providers
	const nim = createOpenAICompatible({
		name: "nim",
		baseURL: "https://integrate.api.nvidia.com/v1",
		headers: {
			Authorization: `Bearer ${env.NIM_API_KEY}`,
		},
	});

	const openrouter = createOpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
	});

	// Select model based on provider
	const modelProvider = getModelProvider(account.name);
	const useOpenRouter = modelProvider === "openrouter";
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const selectedModel = (
		useOpenRouter
			? openrouter(account.modelName)
			: nim.chatModel(account.modelName)
	) as any;

	// Track step count for telemetry
	let currentStepNumber = 0;

	// Build output configuration - only use structured output for OpenRouter models
	// NIM models don't support structuredOutputs, so we rely on tool calls only
	const outputConfig = useOpenRouter
		? Output.object({ schema: agentOutputSchema })
		: undefined;

	// Create the agent
	const agent = new ToolLoopAgent({
		model: selectedModel,
		instructions: systemPrompt,
		// Stop when holding is called OR after 10 steps maximum
		stopWhen: [hasToolCall("holding"), stepCountIs(10)],
		toolChoice: "auto",
		// Call options schema for type-safe runtime configuration
		callOptionsSchema,
		// Inject account context and configure model-specific options before loop starts
		prepareCall: async ({ options, ...settings }) => {
			const modelId = account.modelName.toLowerCase();

			// Models that don't support "required" tool choice
			const autoToolModels = [
				"glm-4",
				"minimax-m2",
				"kimi-k2",
				"gpt-oss",
				"qwen3-next",
				"deepseek-r1",
			];
			const requiresAutoToolChoice = autoToolModels.some((id) =>
				modelId.includes(id),
			);

			return {
				...settings,
				...(requiresAutoToolChoice && { toolChoice: "auto" as const }),
				providerOptions: {
					openrouter: {
						reasoning: {
							effort: options?.reasoningEffort ?? "high",
							exclude: false,
						},
					},
				},
			};
		},
		// Per-step telemetry for cost tracking and debugging
		onStepFinish: ({ toolCalls, usage }) => {
			currentStepNumber++;
			const toolNames = toolCalls?.map((tc) => tc.toolName) ?? [];
			const inputTokens = usage?.inputTokens ?? 0;
			const outputTokens = usage?.outputTokens ?? 0;

			// Capture step telemetry via callback
			if (onStepTelemetry) {
				onStepTelemetry({
					stepNumber: currentStepNumber,
					toolNames,
					inputTokens,
					outputTokens,
					totalTokens: inputTokens + outputTokens,
					timestamp: new Date().toISOString(),
				});
			}

			// Also send to Sentry
			Sentry.startSpan(
				{ name: `tradeAgent.step.${currentStepNumber}`, op: "ai.step" },
				(span) => {
					span.setAttributes({
						"ai.step_number": currentStepNumber,
						"ai.tool_calls_count": toolCalls?.length ?? 0,
						"ai.tool_names": toolNames.join(","),
						"ai.input_tokens": inputTokens,
						"ai.output_tokens": outputTokens,
						"ai.total_tokens": inputTokens + outputTokens,
						"ai.model": account.modelName,
						"ai.account_id": account.id,
					});
				},
			);
		},
		// Provider options for reasoning models
		providerOptions: {
			openrouter: {
				reasoning: {
					effort: "high",
					exclude: false,
				},
			},
		},
		// Structured output schema - only for OpenRouter models that support it
		// NIM models don't support structuredOutputs, so we rely on tool calls only
		...(outputConfig && { output: outputConfig }),
		// Create tools with shared context
		tools: createTradingTools(toolContext),
	});

	/**
	 * Reset step counter for retry attempts
	 */
	const resetStepCounter = () => {
		currentStepNumber = 0;
	};

	return {
		agent,
		resetStepCounter,
	};
}

export type TradeAgent = ReturnType<typeof createTradeAgent>;
