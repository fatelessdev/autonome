import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelChatSkeleton } from "./loading-skeletons";
import type { Conversation } from "./types";
import {
	extractMarkdownPreview,
	extractTradingDecisions,
	formatDecisionDetails,
	formatTimestamp,
	resolveModelIdentity,
} from "./utils";

type ModelChatTabProps = {
	conversations: Conversation[];
	loading: boolean;
	filterMenu: React.ReactNode;
};

type Panel = "response" | "decisions";

export function ModelChatTab({
	conversations,
	loading,
	filterMenu,
}: ModelChatTabProps) {
	const [expandedResponses, setExpandedResponses] = useState<Set<string>>(
		new Set(),
	);
	const [activeConversationPanels, setActiveConversationPanels] = useState<
		Record<string, Panel>
	>({});

	const toggleResponseExpansion = (conversationId: string) => {
		setExpandedResponses((prev) => {
			const next = new Set(prev);
			if (next.has(conversationId)) {
				next.delete(conversationId);
				setActiveConversationPanels((panels) => {
					const updated = { ...panels };
					delete updated[conversationId];
					return updated;
				});
			} else {
				next.add(conversationId);
				setActiveConversationPanels((panels) => ({
					...panels,
					[conversationId]: panels[conversationId] ?? "response",
				}));
			}
			return next;
		});
	};

	const setConversationPanel = (conversationId: string, panel: Panel) => {
		setExpandedResponses((prev) => {
			if (prev.has(conversationId)) return prev;
			const next = new Set(prev);
			next.add(conversationId);
			return next;
		});
		setActiveConversationPanels((panels) => ({
			...panels,
			[conversationId]: panel,
		}));
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			{filterMenu}
			<div className="relative flex-1 min-h-0">
				<ScrollArea className="h-full overflow-auto">
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
						<div>
							{conversations.map((conv, idx) => {
								const modelInfo = resolveModelIdentity({
									modelLogo: conv.modelLogo,
									modelName: conv.modelName,
								});
								const modelColor = modelInfo.color || "#888888";
								const modelLabel = modelInfo.label;
								const isExpanded = expandedResponses.has(conv.id);
								const previewText = extractMarkdownPreview(conv.response);
								const tradingDecisions = extractTradingDecisions(
									conv.toolCalls,
								);
								const activePanel =
									activeConversationPanels[conv.id] ?? "response";

								return (
									<div key={conv.id}>
										<div
											className="rounded px-4 py-4 transition-colors hover:bg-accent/30"
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
													{formatTimestamp(conv.timestamp)}
												</span>
											</div>

											<button
												type="button"
												onClick={() => toggleResponseExpansion(conv.id)}
												className="w-full text-left"
											>
												<div
													className="rounded-lg border p-3 transition-colors cursor-pointer"
													style={{
														backgroundColor: `${modelColor}12`,
														borderColor: `${modelColor}33`,
													}}
												>
													<p className="text-sm leading-relaxed text-muted-foreground cursor-pointer">
														{previewText || "No response yet."}
													</p>
													<div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
														{isExpanded ? "Hide context" : "Click to expand"}
													</div>
												</div>
											</button>

											{isExpanded ? (
												<div className="mt-4 space-y-4">
													<div
														className="flex items-center gap-2 rounded-lg border bg-background/70 p-1"
														style={{ borderColor: `${modelColor}22` }}
													>
														{(["response", "decisions"] as Panel[]).map(
															(panel) => {
																const isActive = activePanel === panel;
																return (
																	<button
																		key={panel}
																		type="button"
																		onClick={() =>
																			setConversationPanel(conv.id, panel)
																		}
																		className={`flex-1 cursor-pointer rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
																			isActive
																				? "bg-accent text-foreground"
																				: "text-muted-foreground hover:bg-accent/40"
																		}`}
																	>
																		{panel === "response"
																			? "Response"
																			: "Trading Decisions"}
																	</button>
																);
															},
														)}
													</div>

													{activePanel === "response" ? (
														<section>
															<div
																className="rounded-lg border bg-background/60 p-3"
																style={{ borderColor: `${modelColor}33` }}
															>
																<div className="prose prose-invert prose-sm max-w-none">
																	<ReactMarkdown
																		remarkPlugins={[remarkGfm]}
																		rehypePlugins={[rehypeRaw]}
																	>
																		{conv.response || "No response"}
																	</ReactMarkdown>
																</div>
															</div>
														</section>
													) : (
														<section>
															{tradingDecisions.length === 0 ? (
																<div className="rounded-lg border border-dashed bg-background/40 p-3 text-xs text-muted-foreground">
																	No explicit trading decisions recorded for
																	this invocation.
																</div>
															) : (
																<div className="space-y-3">
																	{tradingDecisions.map((decision) => {
																		const {
																			confidenceLabel,
																			quantityLabel,
																			leverageLabel,
																			targetLabel,
																			stopLabel,
																		} = formatDecisionDetails(decision);

																		const action = (
																			decision.action ||
																			decision.toolCallType ||
																			"OTHER"
																		).toUpperCase();
																		const isUpdateCall =
																			action === "UPDATE_EXIT_PLAN";
																		const isCloseCall =
																			action === "CLOSE_POSITION";
																		const isHoldSignal =
																			decision.signal === "HOLD";
																		const signalLabel = isUpdateCall
																			? "Exit Plan Update"
																			: isCloseCall
																				? `Close ${decision.signal}`
																				: decision.signal;
																		const badgeVariant =
																			isHoldSignal &&
																			!isUpdateCall &&
																			!isCloseCall
																				? "secondary"
																				: "outline";
																		const badgeClass = (() => {
																			if (isUpdateCall) {
																				return "border-sky-500/30 bg-sky-500/12 text-sky-400";
																			}
																			if (isCloseCall) {
																				return "border-amber-500/30 bg-amber-500/12 text-amber-600";
																			}
																			if (decision.signal === "SHORT") {
																				return "border-red-500/20 bg-red-500/10 text-red-500";
																			}
																			if (decision.signal === "LONG") {
																				return "border-green-500/20 bg-green-500/10 text-green-500";
																			}
																			return "border-muted text-foreground";
																		})();

																		const statusLabel = (() => {
																			if (decision.status)
																				return decision.status;
																			if (isUpdateCall) return "UPDATED";
																			if (isCloseCall) {
																				return decision.result?.success ===
																					false && decision.result?.error
																					? "FAILED"
																					: "CLOSED";
																			}
																			if (decision.result?.success === true)
																				return "EXECUTED";
																			if (decision.result?.success === false)
																				return "REJECTED";
																			if (isHoldSignal) return "HOLD";
																			return null;
																		})();

																		const showInvalidationRow = !isUpdateCall;
																		const reasonContent = isUpdateCall
																			? (decision.reason ??
																				decision.invalidationCondition)
																			: null;

																		return (
																			<div
																				key={decision.key}
																				className="rounded-xl border bg-background/60 p-3 shadow-sm"
																				style={{
																					borderColor: `${modelColor}33`,
																				}}
																			>
																				<div className="flex flex-wrap items-start justify-between gap-4">
																					<div className="flex flex-col gap-1">
																						<div className="flex flex-wrap items-center gap-2">
																							<span className="text-sm font-semibold uppercase tracking-wide">
																								{decision.symbol}
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
																					<div>Leverage</div>
																					<div className="text-right font-medium text-foreground tabular-nums">
																						{leverageLabel}
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
																							<div className="text-muted-foreground">
																								Invalidation
																							</div>
																							<div className="mt-1 text-foreground">
																								{decision.invalidationCondition ??
																									"—"}
																							</div>
																						</div>
																					) : null}
																				</div>
																				{isUpdateCall && reasonContent ? (
																					<div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/10 p-2 text-xs text-sky-300">
																						{reasonContent}
																					</div>
																				) : null}
																				{decision.result?.success === false &&
																				decision.result?.error ? (
																					<div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400">
																						{decision.result.error}
																					</div>
																				) : null}
																			</div>
																		);
																	})}
																</div>
															)}
														</section>
													)}
												</div>
											) : null}
										</div>
										{idx < conversations.length - 1 && (
											<div className="border-b mx-4" />
										)}
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
