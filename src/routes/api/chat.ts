import "@/polyfill";

import { google } from "@ai-sdk/google";
import type { MistralLanguageModelOptions } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, ToolLoopAgent } from "ai";
import { createFileRoute } from "@tanstack/react-router";

import { SQL_ASSISTANT_PROMPT } from "@/server/ai/sqlPrompt";
import { tools } from "@/server/ai/tools";

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
        }
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

    const sqlAgent = new ToolLoopAgent({
      model: google("gemini-2.5-flash"),
      instructions: SQL_ASSISTANT_PROMPT,
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
      },
      tools,
      toolChoice: "auto",
      prepareStep: async ({ messages: stepMessages }) => {
        // Use a stronger model for complex reasoning after initial steps
        if (stepMessages.length > 0) {
          return {
            model: model,
          };
        }
        // Continue with default settings
        return {};
      },
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
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
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