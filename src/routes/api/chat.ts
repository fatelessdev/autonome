import "@/polyfill";
import { type MistralLanguageModelOptions } from "@ai-sdk/mistral";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { convertToModelMessages, ToolLoopAgent, stepCountIs } from "ai";
import { createFileRoute } from "@tanstack/react-router";

import { env } from "@/env";
import { SQL_ASSISTANT_PROMPT } from "@/server/chat/sqlPrompt";
import { tools } from "@/server/chat/tools";

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

		const openrouter = createOpenRouter({
			apiKey: env.OPENROUTER_API_KEY,
		});

		const sqlAgent = new ToolLoopAgent({
			// model: primaryModel,
			model: openrouter("xiaomi/mimo-v2-flash:free") as any,
			instructions: SQL_ASSISTANT_PROMPT,
			// instructions: "You are an helpful assistant",
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
				openrouter: {
					reasoning: {
						effort: "low",
						exclude: false, // Set true to hide thinking from final output
					},
                    plugins: [
                        { id: 'response-healing' }
                    ]
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
