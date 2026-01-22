/**
 * Trade Agent Factory
 * Creates and configures the ToolLoopAgent for trading
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ToolLoopAgent, stepCountIs, hasToolCall } from "ai";
import * as Sentry from "@sentry/react";

import { getNextNimApiKey, getNextOpenRouterApiKey } from "@/env";
import type { Account } from "@/server/features/trading/accounts";
import type { StepTelemetry } from "@/server/features/trading/invocationResponse";
import { getModelProvider } from "@/shared/models/modelConfig";

import { callOptionsSchema } from "./schemas";
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
	/**
	 * Callback to rebuild the user prompt with fresh data.
	 * Called before each step after the first to ensure the agent
	 * sees current portfolio state (cash, exposure, positions).
	 */
	rebuildUserPrompt?: () => Promise<string>;
}

/**
 * Creates a configured ToolLoopAgent for trading
 */
export function createTradeAgent(config: TradeAgentConfig) {
	const { account, systemPrompt, toolContext, onStepTelemetry, rebuildUserPrompt } = config;

	// Initialize providers - use cycling API key for NIM to avoid rate limits
	const nimApiKey = getNextNimApiKey();
	const nim = createOpenAICompatible({
		name: "nim",
		baseURL: "https://integrate.api.nvidia.com/v1",
		headers: {
			Authorization: `Bearer ${nimApiKey}`,
		},
		// fetch: async (url, options) => {
		// 	if (options.method === 'POST' && options.body) {
		// 		const body = JSON.parse(options.body as string);

		// 		// INJECT YOUR CUSTOM PARAMETERS HERE
		// 		body.chat_template_kwargs = { thinking: true };

		// 		options.body = JSON.stringify(body);
		// 	}
		// 	return fetch(url, options);
		// },
	});

	const openRouterApiKey = getNextOpenRouterApiKey();
	const openrouter = createOpenRouter({
		apiKey: openRouterApiKey,
	});

	// Select model based on provider
	const modelProvider = getModelProvider(account.name);
	const useOpenRouter = modelProvider === "openrouter";
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const selectedModel = (
		useOpenRouter
			? openrouter.chat(account.modelName)
			: nim.chatModel(account.modelName)
	) as any;

	// Track step count for telemetry
	let currentStepNumber = 0;

	// Build output configuration - only use structured output for OpenRouter models
	// NIM models don't support structuredOutputs, so we rely on tool calls only
	// const _outputConfig = useOpenRouter
	// 	? Output.object({ schema: agentOutputSchema })
	// 	: undefined;

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
				"mistral-large-3-675b-instruct-2512"
			];
			const requiresAutoToolChoice = autoToolModels.some((id) =>
				modelId.includes(id),
			);

			return {
				...settings,
				...(requiresAutoToolChoice && { toolChoice: "auto" as const }),
				providerOptions: {
					// openrouter: {
					// 	reasoning: {
					// 		effort: options?.reasoningEffort ?? "high",
					// 		exclude: false,
					// 	},
					// },
				},
			};
		},
		// Append state update as new message instead of rewriting history.
		// This preserves conversation causality - the model sees its original context
		// plus incremental state updates, avoiding confusion about past decisions.
		prepareStep: async ({ stepNumber, messages }) => {
			// Base result (no tool restrictions - using prompt-based hysteresis instead)
			const baseResult: {
				messages?: typeof messages;
			} = {};

			// Only add state update after the first step (when there have been tool calls)
			if (stepNumber === 0 || !rebuildUserPrompt) {
				return baseResult;
			}

			try {
				// Get compact state summary (not full prompt)
				const stateSummary = await rebuildUserPrompt();

				// Append as a new user message instead of rewriting the first one
				// This preserves the original context and shows state progression
				const updatedMessages = [
					...messages,
					{
						role: "user" as const,
						content: stateSummary,
					},
				];

				return { ...baseResult, messages: updatedMessages };
			} catch (error) {
				console.warn(
					`[TradeAgent] Failed to refresh prompt for step ${stepNumber}:`,
					error,
				);
				return baseResult;
			}
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
		// ...(outputConfig && { output: outputConfig }),
		// Create tools with shared context
		tools: createTradingTools(toolContext),
	});

	return {
		agent,
	};
}

export type TradeAgent = ReturnType<typeof createTradeAgent>;
