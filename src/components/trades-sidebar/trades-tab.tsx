import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/shared/formatting/numberFormat";
import { TradesListSkeleton } from "./loading-skeletons";
import type { Trade } from "./types";
import {
	computeHoldingLabel,
	formatTimestamp,
	resolveModelIdentity,
} from "./utils";

type TradesTabProps = {
	trades: Trade[];
	loading: boolean;
	filterMenu: React.ReactNode;
};

export function TradesTab({ trades, loading, filterMenu }: TradesTabProps) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			{filterMenu}
			<div className="relative flex-1 min-h-0">
				<ScrollArea className="h-full overflow-auto">
					{loading ? (
						<TradesListSkeleton />
					) : trades.length === 0 ? (
						<div className="flex items-center justify-center p-8">
							<p className="text-muted-foreground text-sm">
								No completed trades yet
							</p>
						</div>
					) : (
						<div>
							{trades.map((trade, idx) => {
								const modelInfo = resolveModelIdentity({
									modelKey: trade.modelKey,
									modelName: trade.modelName,
									modelRouterName: trade.modelRouterName,
								});
								const modelColor = modelInfo.color || "#888888";
								const modelLabel = modelInfo.label;
								const isShort = trade.side === "SHORT";
								const netPnlValue = trade.netPnl ?? 0;
								const isProfitable = netPnlValue >= 0;
								const timestampLabel =
									trade.timestamp ?? formatTimestamp(trade.closedAt);
								const holdingLabel =
									trade.holdingTime ??
									computeHoldingLabel(trade.openedAt, trade.closedAt);
								const quantityLabel =
									trade.quantity != null ? trade.quantity.toFixed(3) : "--";
								const entryPriceLabel =
									trade.entryPrice != null
										? formatCurrency(trade.entryPrice)
										: "--";
								const exitPriceLabel =
									trade.exitPrice != null
										? formatCurrency(trade.exitPrice)
										: "--";
								const entryNotionalLabel =
									trade.entryNotional != null
										? formatCurrency(trade.entryNotional)
										: "--";
								const exitNotionalLabel =
									trade.exitNotional != null
										? formatCurrency(trade.exitNotional)
										: "--";
								const pnlLabel =
									trade.netPnl != null ? formatCurrency(trade.netPnl) : "--";

								return (
									<div key={trade.id}>
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
																src={modelInfo.logo}
																alt={modelLabel}
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
													{timestampLabel}
												</span>
											</div>

											<div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
												<span className="text-muted-foreground">
													completed a
												</span>
												<Badge
													variant={isShort ? "outline" : "default"}
													className={`text-xs font-semibold ${
														isShort
															? "border-red-500/20 bg-red-500/10 text-red-500"
															: "bg-green-500/20 text-green-700"
													}`}
												>
													{isShort ? "SHORT" : "LONG"}
												</Badge>
												<span className="text-muted-foreground">trade on</span>
												<Badge
													variant="outline"
													className="text-xs font-semibold"
												>
													{trade.symbol}
												</Badge>
											</div>

											<div className="space-y-1 text-xs">
												<div className="flex justify-between">
													<span className="text-muted-foreground">Price:</span>
													<span className="font-light flex items-center gap-1">
														{entryPriceLabel}
														{trade.exitPrice != null ? (
															<>
																<ArrowRight className="h-3 w-3" />
																{exitPriceLabel}
															</>
														) : (
															""
														)}
													</span>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground">
														Quantity:
													</span>
													<span className="font-light">{quantityLabel}</span>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground">
														Notional:
													</span>
													<span className="font-light flex items-center gap-1">
														{entryNotionalLabel}
														{trade.exitNotional != null ? (
															<>
																<ArrowRight className="h-3 w-3" />
																{exitNotionalLabel}
															</>
														) : (
															""
														)}
													</span>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground">
														Holding time:
													</span>
													<span className="font-light">{holdingLabel}</span>
												</div>
											</div>

											<div className="mt-3">
												<div className="flex items-center justify-between">
													<span className="text-xs font-semibold uppercase tracking-wide">
														NET P&L:
													</span>
													<span
														className={`text-base font-bold tabular-nums ${
															isProfitable ? "text-green-500" : "text-red-500"
														}`}
													>
														{isProfitable && trade.netPnl != null ? "+" : ""}
														{pnlLabel}
													</span>
												</div>
											</div>
										</div>
										{idx < trades.length - 1 && (
											<div className="mx-4 border-b" />
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
