import NumberFlow from "@number-flow/react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MARKET_QUERIES } from "@/core/shared/markets/marketQueries";
import { calculateUnrealizedPnl } from "@/core/shared/trading/calculations";
import {
	formatCurrencyValue,
	formatLeverageValue,
} from "@/shared/formatting/numberFormat";
import { PositionsListSkeleton } from "./loading-skeletons";
import type { ExitPlanSelection, ModelPositions } from "./types";
import { resolveModelIdentity } from "./utils";

type PositionsTabProps = {
	positions: ModelPositions[];
	loading: boolean;
	filterMenu: React.ReactNode;
	onSelectExitPlan: (selection: ExitPlanSelection) => void;
};

export function PositionsTab({
	positions,
	loading,
	filterMenu,
	onSelectExitPlan,
}: PositionsTabProps) {
	// Use market prices that refresh every 10 seconds for real-time P&L
	const { data: marketPrices } = useQuery(MARKET_QUERIES.prices());

	// Build a price map for quick lookup
	const priceMap = useMemo(() => {
		const map = new Map<string, number>();
		if (marketPrices) {
			for (const price of marketPrices) {
				if (Number.isFinite(price.price)) {
					map.set(price.symbol.toUpperCase(), price.price);
				}
			}
		}
		return map;
	}, [marketPrices]);

	// Enrich positions with live P&L calculations
	const enrichedPositions = useMemo(() => {
		return positions.map((modelPos) => {
			const enrichedModelPositions = modelPos.positions.map((position) => {
				const currentPrice = priceMap.get(position.symbol.toUpperCase()) ?? null;
				const liveUnrealizedPnl = calculateUnrealizedPnl(position, currentPrice);
				return {
					...position,
					liveUnrealizedPnl,
				};
			});

			const liveTotalUnrealizedPnl = enrichedModelPositions.reduce(
				(sum, pos) => sum + pos.liveUnrealizedPnl,
				0,
			);

			return {
				...modelPos,
				positions: enrichedModelPositions,
				liveTotalUnrealizedPnl,
			};
		});
	}, [positions, priceMap]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			{filterMenu}
			<div className="relative flex-1 min-h-0">
				<ScrollArea className="h-full overflow-auto">
					{loading ? (
						<PositionsListSkeleton />
					) : enrichedPositions.length === 0 ||
						enrichedPositions.every((group) => group.positions.length === 0) ? (
						<div className="flex items-center justify-center p-8">
							<div className="text-center text-muted-foreground">
								<p className="mb-2 font-medium text-sm">No Open Positions</p>
								<p className="text-xs">
									Open positions will appear here when models create trades.
								</p>
							</div>
						</div>
					) : (
						<div>
							{enrichedPositions.map((modelPos, modelIdx) => {
								if (modelPos.positions.length === 0) return null;
								const modelInfo = resolveModelIdentity({
									modelLogo: modelPos.modelLogo,
									modelName: modelPos.modelName,
								});
								const modelColor = modelInfo.color || "#888888";
								const modelLabel = modelInfo.label;
								const totalUnrealizedNumeric = modelPos.liveTotalUnrealizedPnl;
								const totalIsPositive = totalUnrealizedNumeric >= 0;

								return (
									<div
										key={modelPos.modelId}
										style={{ backgroundColor: `${modelColor}15` }}
									>
										<div className="border-b px-4 py-3">
											<div className="flex items-center justify-between">
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
												<div className="text-right">
													<div className="text-[10px] uppercase tracking-wider text-muted-foreground">
														Total Unrealized P&L:
													</div>
													<div
														className={`font-bold text-base tabular-nums ${
															totalIsPositive
																? "text-green-500"
																: "text-red-500"
														}`}
													>
														<NumberFlow
															value={totalUnrealizedNumeric}
															format={{
																style: "currency",
																currency: "USD",
																currencyDisplay: "narrowSymbol",
																signDisplay: "always",
																minimumFractionDigits: 2,
																maximumFractionDigits: 2,
															}}
														/>
													</div>
												</div>
											</div>
										</div>

										<div>
											<div className="grid grid-cols-6 gap-x-2 border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
												<div>SIDE</div>
												<div>COIN</div>
												<div className="text-center">LEVERAGE</div>
												<div className="text-right">NOTIONAL</div>
												<div className="text-center">EXIT PLAN</div>
												<div className="text-right">UNREAL P&L</div>
											</div>

											{modelPos.positions.map((position, idx) => {
												const unrealizedPnl = position.liveUnrealizedPnl;
												const isPnlPositive = unrealizedPnl >= 0;
												const hasExitPlan = Boolean(
													position.exitPlan?.target ||
														position.exitPlan?.stop ||
														position.exitPlan?.invalidation,
												);
												const signal = position.signal ?? position.sign;

												return (
													<div
														key={`${modelPos.modelId}-${position.symbol}-${idx}`}
														className={`grid grid-cols-6 gap-x-2 px-4 py-2.5 text-[0.7rem] transition-colors hover:bg-accent/20 ${
															idx < modelPos.positions.length - 1
																? "border-b"
																: ""
														}`}
													>
														<div className="flex items-center whitespace-nowrap">
															<span
																className={`font-bold uppercase ${signal === "LONG" ? "text-green-500" : "text-red-500"}`}
															>
																{signal}
															</span>
														</div>
														<div className="flex items-center gap-1.5 whitespace-nowrap">
															{renderSymbolIcon(position.symbol)}
															<span className="font-bold">
																{position.symbol}
															</span>
														</div>
														<div className="flex items-center justify-center whitespace-nowrap">
															<span className="font-bold tabular-nums">
																{formatLeverageValue(position.leverage)}
															</span>
														</div>
														<div className="flex items-center justify-end whitespace-nowrap">
															<span className="font-bold tabular-nums text-green-500">
																{formatCurrencyValue(position.notional)}
															</span>
														</div>
														<div className="flex items-center justify-center whitespace-nowrap">
															{hasExitPlan ? (
																<button
																	type="button"
																	onClick={() =>
																		onSelectExitPlan({
																			modelLabel,
																			modelColor,
																			position,
																		})
																	}
																	className="cursor-pointer rounded border border-foreground/20 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:bg-accent"
																>
																	VIEW
																</button>
															) : (
																<span className="text-muted-foreground">—</span>
															)}
														</div>
														<div className="flex items-center justify-end whitespace-nowrap">
															<span
																className={`font-bold tabular-nums ${
																	isPnlPositive
																		? "text-green-500"
																		: "text-red-500"
																}`}
															>
																<NumberFlow
																	value={unrealizedPnl}
																	format={{
																		style: "currency",
																		currency: "USD",
																		currencyDisplay: "narrowSymbol",
																		signDisplay: "always",
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	}}
																/>
															</span>
														</div>
													</div>
												);
											})}

											{modelPos.availableCash !== undefined ? (
												<div className="border-t px-4 py-2 text-xs bg-muted/20">
													<div className="flex items-center justify-between">
														<span className="font-bold uppercase tracking-wide text-muted-foreground">
															Available Cash:
														</span>
														<span className="font-bold tabular-nums">
															{formatCurrencyValue(modelPos.availableCash)}
														</span>
													</div>
												</div>
											) : null}
										</div>
										{modelIdx < enrichedPositions.length - 1 && <div className="h-2" />}
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

const SYMBOL_ICON_MAP: Record<string, { src: string; alt: string }> = {
	BTC: { src: "/coins/btc.svg", alt: "BTC" },
	ETH: { src: "/coins/eth.svg", alt: "ETH" },
	SOL: { src: "/coins/sol.svg", alt: "SOL" },
	ZEC: { src: "/coins/zec.webp", alt: "ZEC" },
	HYPE: { src: "/coins/hype.webp", alt: "HYPE" },
};

function renderSymbolIcon(symbol: string) {
	const icon = SYMBOL_ICON_MAP[symbol];
	if (!icon) {
		return <span className="text-lg">●</span>;
	}
	return (
		<img
			src={icon.src}
			alt={icon.alt}
			width={16}
			height={16}
			className="h-4 w-4"
			style={{ objectFit: "contain" }}
			loading="lazy"
		/>
	);
}
