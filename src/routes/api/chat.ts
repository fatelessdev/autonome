import "@/polyfill";
import { mistral, type MistralLanguageModelOptions } from "@ai-sdk/mistral";
import { convertToModelMessages, ToolLoopAgent, stepCountIs } from "ai";
import { createFileRoute } from "@tanstack/react-router";

import { SQL_ASSISTANT_PROMPT } from "@/server/chat/sqlPrompt";
import { tools } from "@/server/chat/tools";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "@/env";
// Primary model for initial analysis and tool orchestration
const primaryModel = mistral("codestral-latest");

// AI SDK-compatible chat endpoint
async function handleChat({ request }: { request: Request }) {
	try {
		const body = await request.json();
		const { messages } = body;

		if (!messages || !Array.isArray(messages)) {
			return new Response(
				JSON.stringify({ error: "Invalid request: messages array required" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		const nim = createOpenAICompatible({
			name: "nim",
			baseURL: "https://integrate.api.nvidia.com/v1",
			headers: {
				Authorization: `Bearer ${env.NIM_API_KEY}`,
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
		const openrouter = createOpenRouter({
			apiKey: env.OPENROUTER_API_KEY,
		});

		const sqlAgent = new ToolLoopAgent({
			// model: primaryModel,
			model: mistral("codestral-latest"),
			// instructions: SQL_ASSISTANT_PROMPT,
			instructions: "You are an helpful assistant",
			providerOptions: {
				google: {
					thinkingConfig: {
						thinkingBudget: 8192,
						includeThoughts: true,
					},
				},
				mistral: {
					parallelToolCalls: true,
				} satisfies MistralLanguageModelOptions,
				nim: {
					chat_template_kwargs: { thinking: false }
				},
				openrouter: {
					reasoning: {
						effort: 'high',
						exclude: false, // Set true to hide thinking from final output
					}
				},
			},
			tools,
			toolChoice: "auto",
			stopWhen: stepCountIs(10),
		});

		const result = await sqlAgent.stream({
			messages: convertToModelMessages(messages),
		});

		return result.toUIMessageStreamResponse({
			sendReasoning: true,
			sendSources: true,
		});
	} catch (error) {
		console.error("[AI Chat] Error:", error);
		return new Response(
			JSON.stringify({
				error: "Internal server error",
				message: error instanceof Error ? error.message : "Unknown error",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: handleChat,
		},
	},
});
