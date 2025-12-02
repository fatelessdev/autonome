import { useChat } from "@ai-sdk/react";
import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";
import { createFileRoute } from "@tanstack/react-router";
import { SquareIcon } from "lucide-react";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Response } from "@/components/response";
import {
	SqlResultCard,
	type SqlResultPayload,
} from "@/components/sql-result-card";

export const Route = createFileRoute("/chat")({
	component: AIPage,
});

function AIPage() {
	return (
		<div className="relative min-h-screen w-full overflow-hidden">
			<div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-12 pt-16 sm:px-6 lg:px-8">
				<ChatInterface />
			</div>
		</div>
	);
}

function ChatInterface() {
	// useChat defaults to /api/chat endpoint
	const { messages, status, sendMessage, stop, error } = useChat();

	const handlePromptSubmit = ({ text }: PromptInputMessage) => {
		const value = text.trim();
		if (!value) {
			return;
		}

		return sendMessage({ text: value });
	};

	return (
		<div className="flex h-full w-full flex-1 flex-col gap-6">
			{messages.length === 0 && (
				<div className="space-y-2 text-center">
					<h1 className="text-4xl font-medium">
						Ask across your autonomous traders
					</h1>
					<p className="text-base">
						Chat with portfolio telemetry, run SQL queries, and surface insights
						from every model.
					</p>
				</div>
			)}

			<section className="flex flex-1 flex-col overflow-hidden rounded-3xl">
				<div className="relative flex flex-1 overflow-hidden rounded-3xl">
					<Conversation className="flex-1">
						<ConversationContent className="gap-6 px-4 py-6 pb-24 sm:px-8">
							{messages.length === 0 && <EmptyState />}

							{messages.map((message) => (
								<Message key={message.id} from={message.role}>
									<MessageContent className="max-w-3xl rounded-2xl p-3 text-base leading-relaxed">
										{message.parts.map((part, index) => {
											const key = `${message.id}-${index}`;
											return renderMessagePart(part, key);
										})}
									</MessageContent>
								</Message>
							))}

							{status === "submitted" && (
								<div className="flex items-center gap-3 text-sm">
									<Loader className="" />
									<Shimmer className="">
										Thinking through your data…
									</Shimmer>
								</div>
							)}

							{error && (
								<div className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-100">
									{error.message}
								</div>
							)}
						</ConversationContent>
						<ConversationScrollButton className="" />
					</Conversation>
				</div>
			</section>

			<PromptInput
				onSubmit={handlePromptSubmit}
				className=""
			>
				<PromptInputBody className="">
					<PromptInputTextarea className="min-h-16 resize-none px-5 py-4 text-base focus-visible:ring-0 focus-visible:ring-offset-0" />
				</PromptInputBody>
				<PromptInputFooter className="flex items-center justify-between gap-3 px-3 pb-3">
					<PromptInputTools className="flex flex-1 items-center justify-between text-xs">
						{status === "streaming" ? (
							<PromptInputButton
								aria-label="Stop response"
								className="flex items-center gap-2"
								onClick={stop}
								variant="ghost"
							>
								<SquareIcon className="size-3.5" />
								<span>Stop</span>
							</PromptInputButton>
						) : (
							<span className="">Shift + Enter for newline</span>
						)}
					</PromptInputTools>
					<PromptInputSubmit
						className="rounded-full px-5 py-2 text-sm font-medium"
						status={status}
						variant="default"
					/>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}

function renderMessagePart(
	part: { type: string; [key: string]: unknown },
	key: string,
) {
	if (part.type === "text") {
		const text = typeof part.text === "string" ? part.text : "";
		return (
			<Response
				key={key}
				className="prose prose-sm max-w-none leading-relaxed dark:prose-invert"
			>
				{text}
			</Response>
		);
	}

	if (part.type === "reasoning") {
		const text = typeof part.text === "string" ? part.text : "";
		if (!text) return null;
		const isStreaming =
			part.state === "input-streaming" || part.state === "output-progress";
		return (
			<Reasoning
				key={key}
				className="rounded-2xl px-4 py-3"
				isStreaming={isStreaming}
			>
				<ReasoningTrigger />
				<ReasoningContent>{text}</ReasoningContent>
			</Reasoning>
		);
	}

	if (part.type === "source-url") {
		const url = typeof part.url === "string" ? part.url : undefined;
		if (!url) {
			return null;
		}
		return (
			<a
				key={key}
				href={url}
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1 text-xs font-medium underline"
			>
				Source
			</a>
		);
	}

	if (part.type === "tool-queryPortfolioSql") {
		return renderSqlToolPart(part, key);
	}

	return null;
}

function renderSqlToolPart(
	part: {
		type: string;
		state?: string;
		errorText?: string;
		output?: unknown;
	},
	key: string,
) {
	if (
		part.state === "input-available" ||
		part.state === "input-streaming" ||
		part.state === "output-progress"
	) {
		return (
			<div key={key} className="rounded-2xl p-2 text-sm">
				Running portfolio query…
			</div>
		);
	}

	if (part.state === "output-error") {
		return (
			<div
				key={key}
				className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"
			>
				{part.errorText ?? "The SQL tool failed."}
			</div>
		);
	}

	if (part.state === "output-available" && isSqlPayload(part.output)) {
		return <SqlResultCard key={key} payload={part.output} />;
	}

	return null;
}

function isSqlPayload(payload: unknown): payload is SqlResultPayload {
	if (!payload || typeof payload !== "object") {
		return false;
	}

	const candidate = payload as Record<string, unknown>;
	return typeof candidate.sql === "string" && Array.isArray(candidate.rows);
}

function EmptyState() {
	return (
		<div className="mx-auto w-full max-w-2xl space-y-3 text-sm">
			<p className="text-xs uppercase tracking-wider mt-10">
				Example queries
			</p>
			<div className="space-y-2">
				<div className="rounded-xl  p-3 transition-colors">
					"Summarize the most profitable model this week and include closed
					trade totals."
				</div>
				<div className="rounded-xl  p-3 transition-colors">
					"Show average leverage and confidence by model for the past 20
					invocations."
				</div>
				<div className="rounded-xl  p-3 transition-colors">
					"What is the cumulative realized PnL across BTC trades in the
					simulator?"
				</div>
			</div>
		</div>
	);
}
