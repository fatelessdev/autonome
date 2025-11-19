"use client";
import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";
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
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputFooter,
	PromptInputTools,
	PromptInputButton,
	type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Response } from "@/components/response";
import { SquareIcon } from "lucide-react";
import { DefaultChatTransport } from "ai";
import { ToolOutputRenderer } from "@/components/ai-tool-renderer";

export const Route = createFileRoute("/ai")({
	component: AIPage,
});

function renderMessagePart(
	part: { type: string; [key: string]: unknown },
	key: string,
) {
	if (part.type === "text") {
		const text = typeof part.text === "string" ? part.text : "";
		return (
			<Response
				key={key}
				className="prose prose-sm max-w-none leading-relaxed text-white prose-headings:text-white prose-strong:text-white dark:prose-invert"
			>
				{text}
			</Response>
		);
	}

	// Handle tool outputs using the registry-based renderer
	if (part.type?.startsWith("tool-")) {
		const toolName = part.type.replace("tool-", "");
		return (
			<ToolOutputRenderer
				key={key}
				toolName={toolName}
				state={part.state}
				output={part.output}
				errorText={part.errorText}
			/>
		);
	}

	return null;
}

function AIPage() {
	const { messages, status, sendMessage, stop, error } = useChat({
		transport: new DefaultChatTransport({
			api: "/api/ai",
		}),
	});

	const handlePromptSubmit = ({ text }: PromptInputMessage) => {
		const value = text.trim();
		if (!value) {
			return;
		}
		return sendMessage({ text: value });
	};

	return (
		<div className="relative min-h-screen w-full overflow-hidden text-white">
			<div className="pointer-events-none absolute inset-0">
				<ShaderGradientCanvas
					style={{ width: "100%", height: "100%" }}
					lazyLoad={false}
					fov={undefined}
					pixelDensity={1}
					pointerEvents="none"
				>
					<ShaderGradient
						animate="on"
						type="sphere"
						wireframe={false}
						shader="defaults"
						uTime={0}
						uSpeed={0.3}
						uStrength={0.3}
						uDensity={0.8}
						uFrequency={5.5}
						uAmplitude={3.2}
						positionX={-0.1}
						positionY={0}
						positionZ={0}
						rotationX={0}
						rotationY={130}
						rotationZ={70}
						color1="#73bfc4"
						color2="#ff810a"
						color3="#8da0ce"
						reflection={0.4}
						cAzimuthAngle={270}
						cPolarAngle={180}
						cDistance={0.5}
						cameraZoom={15.1}
						lightType="env"
						brightness={0.8}
						envPreset="city"
						loop="on"
						grain="on"
						toggleAxis={false}
						zoomOut={false}
						hoverState=""
						enableTransition={true}
					/>
				</ShaderGradientCanvas>
				<div className="absolute inset-0 bg-gradient-to-b to-slate-950/60" />
			</div>

			<div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-12 pt-16 sm:px-6 lg:px-8">
				<div className="flex h-full w-full flex-1 flex-col gap-6">
					{messages.length === 0 && (
						<div className="space-y-2 text-center">
							<h1 className="text-4xl font-medium text-white">AI Assistant</h1>
							<p className="text-base text-white/60">
								Chat with AI powered by NVIDIA NIM. Get weather updates and
								more.
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
											<MessageContent className="max-w-3xl rounded-2xl bg-white/[0.03] p-3 text-base leading-relaxed text-white/90 shadow-xl ring-1 ring-white/[0.08] group-[.is-user]:bg-white/5 group-[.is-user]:text-slate-900 group-[.is-user]:shadow-lg group-[.is-user]:ring-white/20">
												{message.parts.map((part, index) => {
													const key = `${message.id}-${index}`;
													return renderMessagePart(part, key);
												})}
											</MessageContent>
										</Message>
									))}

									{status === "submitted" && (
										<div className="flex items-center gap-3 text-sm text-white/70">
											<Loader className="text-white/60" />
											<Shimmer className="text-white/70">
												Thinking through your request…
											</Shimmer>
										</div>
									)}

									{error && (
										<div className="rounded-2xl border border-white/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
											{error.message}
										</div>
									)}
								</ConversationContent>
								<ConversationScrollButton className="bg-white/90 text-slate-900 hover:bg-white" />
							</Conversation>
						</div>
					</section>

					<PromptInput
						onSubmit={handlePromptSubmit}
						className="shadow-[0_40px_140px_rgba(0,0,0,0.45)]"
					>
						<PromptInputBody className="">
							<PromptInputTextarea className="min-h-16 resize-none border-none bg-transparent px-5 py-4 text-base text-white placeholder:text-white/50 focus-visible:ring-0 focus-visible:ring-offset-0" />
						</PromptInputBody>
						<PromptInputFooter className="flex items-center justify-between gap-3 px-3 pb-3">
							<PromptInputTools className="flex flex-1 items-center justify-between text-xs">
								{status === "streaming" ? (
									<PromptInputButton
										aria-label="Stop response"
										className="flex items-center gap-2 text-white/70 hover:text-white"
										onClick={stop}
										variant="ghost"
									>
										<SquareIcon className="size-3.5" />
										<span>Stop</span>
									</PromptInputButton>
								) : (
									<span className="text-white/40">
										Shift + Enter for newline
									</span>
								)}
							</PromptInputTools>
							<PromptInputSubmit
								className="rounded-full bg-white px-5 py-2 text-sm font-medium text-slate-950 hover:bg-white/90"
								status={status}
								variant="default"
							/>
						</PromptInputFooter>
					</PromptInput>
				</div>
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 text-sm text-white/60">
			<div className="text-center mb-8">
				<h2 className="text-2xl font-semibold text-white mb-2">
					🎨 Dynamic Generative UI Assistant
				</h2>
				<p className="text-white/60">
					I can create interactive user interfaces on demand! Just describe what
					you need.
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="space-y-3">
					<h3 className="text-sm font-medium text-white/80 uppercase tracking-wider">
						🔢 Calculations & Data
					</h3>
					<div className="space-y-2">
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Show me a scientific calculator"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Create a chart of sales data"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Make a data table with user information"
						</div>
					</div>
				</div>

				<div className="space-y-3">
					<h3 className="text-sm font-medium text-white/80 uppercase tracking-wider">
						📋 Task Management
					</h3>
					<div className="space-y-2">
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Create a todo list for my project"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Make a progress tracker for goals"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Show me a project task manager"
						</div>
					</div>
				</div>

				<div className="space-y-3">
					<h3 className="text-sm font-medium text-white/80 uppercase tracking-wider">
						🌤️ Weather & Info
					</h3>
					<div className="space-y-2">
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"What's the weather in Tokyo?"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Show me weather with forecast"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Create a weather dashboard"
						</div>
					</div>
				</div>

				<div className="space-y-3">
					<h3 className="text-sm font-medium text-white/80 uppercase tracking-wider">
						🎛️ Forms & UI
					</h3>
					<div className="space-y-2">
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Make a user registration form"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Create alert notifications"
						</div>
						<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-white/70 transition-colors hover:border-white/10 hover:bg-white/[0.04] cursor-pointer">
							"Build a button group interface"
						</div>
					</div>
				</div>
			</div>

			<div className="mt-8 p-4 rounded-2xl border border-white/[0.06] bg-gradient-to-r from-blue-500/10 to-purple-500/10">
				<p className="text-center text-white/80">
					💡 <strong>Pro tip:</strong> Combine requests! Try "Create a dashboard
					with weather, calculator, and todo list"
				</p>
			</div>
		</div>
	);
}
