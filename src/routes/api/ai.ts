import "@/polyfill";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createFileRoute } from "@tanstack/react-router";
import { tools } from "@/components/ai-tool-registry";

// AI SDK-compatible endpoint with dynamic UI generation
async function handleAI({ request }: { request: Request }) {
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
				Authorization: `Bearer ${process.env.NIM_API_KEY}`,
			},
		});
		const model = nim.chatModel("moonshotai/kimi-k2-instruct-0905");

		console.log("[AI] Tools being passed:", Object.keys(tools));
		console.log(
			"[AI] Tool details:",
			Object.entries(tools).map(([key, tool]) => [
				key,
				typeof tool,
				tool?.description,
			]),
		);

		const result = streamText({
			model,
			system: `You are a dynamic generative UI assistant that can create interactive user interfaces on demand.

You have access to powerful tools that generate dynamic UI components:

1. displayWeather - Generate weather cards and forecasts
2. generateCalculator - Create interactive calculators (basic, scientific, currency)
3. generateChart - Generate data visualization charts (bar, line, pie, area, scatter)
4. generateTodoList - Create interactive todo lists with add/remove functionality
5. generateUIComponent - Generate custom components (alerts, tables, forms, buttons, etc.)

STRATEGY:
- Analyze user requests to determine what UI components would be most helpful
- Use tools proactively when users mention: calculations, data, charts, todos, tables, forms
- For weather requests, use displayWeather with appropriate style
- For data visualization, use generateChart with specific chart types
- For task management, use generateTodoList
- For calculations, use generateCalculator
- Combine multiple tools when building complex interfaces
- Use generateUIComponent for specific UI needs (alerts, forms, etc.)

EXAMPLES:
- "Show me a calculator" → generateCalculator
- "Create a todo list for my project" → generateTodoList  
- "Make a chart of sales data" → generateChart
- "What's the weather in Tokyo?" → displayWeather
- "Show me the weather with forecast" → displayWeather with includeForecast
- "Create a data table" → generateUIComponent with data-table
- "Make a form for user input" → generateUIComponent with form-input

Be creative and combine tools to build rich, interactive interfaces!`,
			messages: convertToModelMessages(messages),
			tools,
			toolChoice: "auto",
			maxToolRoundtrips: 10, // Increased for complex multi-component generation
		});

		return result.toUIMessageStreamResponse();
	} catch (error) {
		console.error("[AI] Error:", error);
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

export const Route = createFileRoute("/api/ai")({
	server: {
		handlers: {
			POST: handleAI,
		},
	},
});
