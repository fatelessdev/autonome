import { type ReactNode, useState } from "react";
import { Response } from "@/components/response";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelChatSkeleton } from "./loading-skeletons";
import type { Conversation, TradingDecisionCard } from "./types";
import {
	extractMarkdownPreview,
	extractTradingDecisions,
	formatDecisionDetails,
	formatDecisionSymbol,
	formatTimestamp,
	resolveModelIdentity,
} from "./utils";

type ModelChatTabProps = {
	conversations: Conversation[];
	loading: boolean;
	filterMenu: ReactNode;
};

type Panel = "response" | "decisions" | "prompt";

type DecisionViewProps = {
	decision: TradingDecisionCard;
	modelColor: string;
};

function DecisionCard({ decision, modelColor }: DecisionViewProps) {
	const { confidenceLabel, quantityLabel, targetLabel, stopLabel } =
		formatDecisionDetails(decision);

	const action = (
		decision.action ||
		decision.toolCallType ||
		"OTHER"
	).toUpperCase();
	const isUpdateCall = action === "UPDATE_EXIT_PLAN";
	const isCloseCall = action === "CLOSE_POSITION";
	const isHoldingCall = action === "HOLDING";
	const isHoldSide = decision.side === "HOLD";

	const signalLabel = isHoldingCall
		? "Holding"
		: isUpdateCall
			? "Exit Plan Update"
			: isCloseCall
				? `Close ${decision.side}`
				: decision.side;

	const badgeVariant =
		(isHoldSide || isHoldingCall) && !isUpdateCall && !isCloseCall
			? "secondary"
			: "outline";

	const badgeClass = (() => {
		if (isHoldingCall)
			return "border-slate-500/30 bg-slate-500/12 text-slate-400";
		if (isUpdateCall) return "border-sky-500/30 bg-sky-500/12 text-sky-400";
		if (isCloseCall)
			return "border-amber-500/30 bg-amber-500/12 text-amber-600";
		if (decision.side === "SHORT")
			return "border-red-500/20 bg-red-500/10 text-red-500";
		if (decision.side === "LONG")
			return "border-green-500/20 bg-green-500/10 text-green-500";
		return "border-muted text-foreground";
	})();

	const statusLabel = (() => {
		if (decision.status) return decision.status;
		if (isHoldingCall) return "HOLDING";
		if (isUpdateCall) return "UPDATED";
		if (isCloseCall) {
			return decision.result?.success === false && decision.result?.error
				? "FAILED"
				: "CLOSED";
		}
		if (decision.result?.success === true) return "EXECUTED";
		if (decision.result?.success === false) return "REJECTED";
		if (isHoldSide) return "HOLD";
		return null;
	})();

	const showInvalidationRow = !isUpdateCall && !isHoldingCall;
	const reasonContent = isUpdateCall
		? (decision.reason ?? decision.invalidationCondition)
		: isHoldingCall
			? decision.reason
			: null;

	return (
		<div
			className="rounded-xl border bg-background/60 p-3 shadow-sm"
			style={{ borderColor: `${modelColor}33` }}
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-semibold uppercase tracking-wide">
							{formatDecisionSymbol(decision.symbol)}
						</span>
						<Badge
							variant={badgeVariant}
							className={`text-xs font-semibold uppercase ${badgeClass}`}
						>
							{signalLabel}
						</Badge>
					</div>
					{statusLabel ? (
						<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
							{statusLabel}
						</span>
					) : null}
				</div>
				<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{confidenceLabel}
				</span>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs uppercase tracking-wide text-muted-foreground">
				<div>Quantity</div>
				<div className="text-right font-medium text-foreground tabular-nums">
					{quantityLabel}
				</div>
				<div>Target</div>
				<div className="text-right font-medium text-foreground tabular-nums">
					{targetLabel}
				</div>
				<div>Stop</div>
				<div className="text-right font-medium text-foreground tabular-nums">
					{stopLabel}
				</div>
				{showInvalidationRow ? (
					<div className="col-span-2">
						<div className="text-muted-foreground">Invalidation</div>
						<div className="mt-1 text-foreground">
							{decision.invalidationCondition ?? "—"}
						</div>
					</div>
				) : null}
			</div>

			{(isUpdateCall || isHoldingCall) && reasonContent ? (
				<div
					className={`mt-3 rounded-md border p-2 text-xs ${
						isHoldingCall
							? "border-slate-500/20 bg-slate-500/10 text-slate-300"
							: "border-sky-500/20 bg-sky-500/10 text-sky-300"
					}`}
				>
					{reasonContent}
				</div>
			) : null}

			{decision.result?.success === false && decision.result?.error ? (
				<div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400">
					{decision.result.error}
				</div>
			) : null}
		</div>
	);
}

export function ModelChatTab({
	conversations,
	loading,
	filterMenu,
}: ModelChatTabProps) {
	const [expandedResponses, setExpandedResponses] = useState<Set<string>>(
		new Set(),
	);
	const [activePanels, setActivePanels] = useState<Record<string, Panel>>({});

	const toggleConversation = (conversationId: string) => {
		setExpandedResponses((previous) => {
			const next = new Set(previous);
			if (next.has(conversationId)) {
				next.delete(conversationId);
				setActivePanels((panels) => {
					const updated = { ...panels };
					delete updated[conversationId];
					return updated;
				});
			} else {
				next.add(conversationId);
				setActivePanels((panels) => ({
					...panels,
					[conversationId]: panels[conversationId] ?? "response",
				}));
			}
			return next;
		});
	};

	const setConversationPanel = (conversationId: string, panel: Panel) => {
		setExpandedResponses((previous) => {
			if (previous.has(conversationId)) return previous;
			const next = new Set(previous);
			next.add(conversationId);
			return next;
		});
		setActivePanels((panels) => ({
			...panels,
			[conversationId]: panel,
		}));
	};

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			{filterMenu}
			<div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
				<ScrollArea className="h-full w-full">
					{loading ? (
						<ModelChatSkeleton />
					) : conversations.length === 0 ? (
						<div className="flex items-center justify-center p-8">
							<div className="text-center text-muted-foreground">
								<p className="mb-2 font-medium text-sm">ModelChat</p>
								<p className="text-xs">
									No conversations yet. Models will appear here after making
									trading decisions.
								</p>
							</div>
						</div>
					) : (
						<div className="w-full max-w-full overflow-hidden">
							{conversations.map((conversation, index) => {
								const modelInfo = resolveModelIdentity({
									modelLogo: conversation.modelLogo,
									modelName: conversation.modelName,
								});
								const modelColor = modelInfo.color || "#888888";
								const modelLabel = modelInfo.label;
								const isExpanded = expandedResponses.has(conversation.id);
								const previewText = extractMarkdownPreview(
									conversation.response,
								);
								const tradingDecisions = extractTradingDecisions(
									conversation.toolCalls,
								);
								const activePanel = activePanels[conversation.id] ?? "response";

								return (
									<div
										key={conversation.id}
										className="min-w-0 max-w-full overflow-hidden"
									>
										<div
											className="min-w-0 max-w-full overflow-hidden rounded px-4 py-4 transition-colors hover:bg-accent/30"
											style={{ backgroundColor: `${modelColor}10` }}
										>
											<div className="mb-3 flex items-center justify-between">
												<div className="flex items-center gap-2">
													<div
														style={{
															width: "24px",
															height: "24px",
															borderRadius: "50%",
															backgroundColor: modelColor,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															overflow: "hidden",
														}}
													>
														{modelInfo.logo ? (
															<img
																alt={modelLabel}
																src={modelInfo.logo}
																width={18}
																height={18}
																className="h-[18px] w-[18px] object-contain"
																style={{ objectFit: "contain" }}
																loading="lazy"
															/>
														) : null}
													</div>
													<span className="text-sm font-semibold">
														{modelLabel}
													</span>
												</div>
												<span className="text-xs text-muted-foreground">
													{formatTimestamp(conversation.timestamp)}
												</span>
											</div>

											<button
												type="button"
												onClick={() => toggleConversation(conversation.id)}
												className="w-full overflow-hidden text-left"
											>
												<div
													className="cursor-pointer overflow-hidden rounded-lg border p-3 transition-colors"
													style={{
														backgroundColor: `${modelColor}12`,
														borderColor: `${modelColor}33`,
													}}
												>
													<p
														className="cursor-pointer overflow-hidden text-sm leading-relaxed text-muted-foreground"
														style={{
															wordBreak: "break-all",
															overflowWrap: "anywhere",
														}}
													>
														{previewText || "No response yet."}
													</p>
													<div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
														{isExpanded ? "Hide context" : "Click to expand"}
													</div>
												</div>
											</button>

											{isExpanded ? (
												<div className="mt-4 space-y-4 min-w-0 max-w-full overflow-hidden">
													<div
														className="flex items-center gap-2 rounded-lg border bg-background/70 p-1"
														style={{ borderColor: `${modelColor}22` }}
													>
														{(
															["response", "decisions", "prompt"] as Panel[]
														).map((panel) => {
															const isActive = activePanel === panel;
															return (
																<button
																	key={panel}
																	type="button"
																	onClick={() =>
																		setConversationPanel(conversation.id, panel)
																	}
																	className={`flex-1 cursor-pointer rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
																>
																	{panel === "response"
																		? "Response"
																		: panel === "decisions"
																			? "Trading Decisions"
																			: "Prompt"}
																</button>
															);
														})}
													</div>

													{activePanel === "response" ? (
														<div
															className="min-w-0 max-w-full overflow-hidden rounded-lg border bg-background/60 p-3"
															style={{ borderColor: `${modelColor}33` }}
														>
															<Response className="prose prose-invert prose-sm min-w-0 max-w-none overflow-hidden">
																{conversation.response || "No response"}
															</Response>
														</div>
													) : activePanel === "decisions" ? (
														<div>
															{tradingDecisions.length === 0 ? (
																<div className="rounded-lg border border-dashed bg-background/40 p-3 text-xs text-muted-foreground">
																	No explicit trading decisions recorded for
																	this invocation.
																</div>
															) : (
																<div className="space-y-3">
																	{tradingDecisions.map((decision) => (
																		<DecisionCard
																			key={decision.key}
																			decision={decision}
																			modelColor={modelColor}
																		/>
																	))}
																</div>
															)}
														</div>
													) : (
														<div
															className="rounded-lg border bg-background/60 p-3"
															style={{ borderColor: `${modelColor}33` }}
														>
															{conversation.prompt &&
															conversation.prompt.trim().length > 0 ? (
																<pre className="whitespace-pre-wrap wrap-break-word font-sans text-xs leading-relaxed text-muted-foreground">
																	{conversation.prompt}
																</pre>
															) : (
																<p className="text-xs text-muted-foreground">
																	Prompt payload was not captured for this
																	invocation.
																</p>
															)}
														</div>
													)}
												</div>
											) : null}
											{index < conversations.length - 1 ? (
												<div className="mx-4 border-b" />
											) : null}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</ScrollArea>
			</div>
		</div>
	);
}
