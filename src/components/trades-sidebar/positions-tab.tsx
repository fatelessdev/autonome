import NumberFlow from "@number-flow/react";
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	isSupportedMarketSymbol,
	MARKETS,
} from "@/core/shared/markets/marketMetadata";
import { formatCurrencyValue } from "@/shared/formatting/numberFormat";
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
	// Use server-provided Alpaca values directly (single source of truth)
	const enrichedPositions = useMemo(() => {
		return positions.map((modelPos) => {
			const enrichedModelPositions = modelPos.positions;

			const liveTotalUnrealizedPnl =
				typeof modelPos.totalUnrealizedPnl === "number"
					? modelPos.totalUnrealizedPnl
					: enrichedModelPositions.reduce(
							(sum, pos) => sum + (Number.parseFloat(pos.unrealizedPnl) || 0),
							0,
						);

			const totalRealizedPnl = enrichedModelPositions.reduce(
				(sum, pos) => sum + (Number.parseFloat(pos.realizedPnl) || 0),
				0,
			);

			return {
				...modelPos,
				positions: enrichedModelPositions,
				liveTotalUnrealizedPnl,
				totalRealizedPnl,
			};
		});
	}, [positions]);

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
								const totalRealizedNumeric = modelPos.totalRealizedPnl;
								const realizedIsPositive = totalRealizedNumeric >= 0;
								const totalPnl = totalUnrealizedNumeric + totalRealizedNumeric;
								const totalPnlIsPositive = totalPnl >= 0;

								return (
									<div
										key={modelPos.modelId}
										style={{ backgroundColor: `${modelColor}15` }}
									>
										<div className="border-b px-4 py-3">
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													<div
														className="h-6 w-6 shrink-0 overflow-hidden rounded-full"
														style={{ backgroundColor: modelColor }}
													>
														{modelInfo.logo ? (
															<img
																src={modelInfo.logo}
																alt={modelLabel}
																width={18}
																height={18}
																className="h-full w-full object-cover"
																style={{ objectFit: "contain" }}
																loading="lazy"
															/>
														) : null}
													</div>
													<span className="text-sm font-semibold">
														{modelLabel}
													</span>
												</div>
												<div className="text-right space-y-0.5">
													<div
														className={`font-bold text-base tabular-nums ${
															totalPnlIsPositive
																? "text-green-500"
																: "text-red-500"
														}`}
													>
														<NumberFlow
															value={totalPnl}
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
													<div className="flex items-center justify-end gap-3 text-[10px] tabular-nums">
														<span className="text-muted-foreground">
															Unreal:{" "}
															<span
																className={
																	totalIsPositive
																		? "text-green-500"
																		: "text-red-500"
																}
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
															</span>
														</span>
														<span className="text-muted-foreground">
															Real:{" "}
															<span
																className={
																	realizedIsPositive
																		? "text-green-500"
																		: "text-red-500"
																}
															>
																<NumberFlow
																	value={totalRealizedNumeric}
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
														</span>
													</div>
												</div>
											</div>
										</div>

										<div>
											<div className="grid grid-cols-5 gap-x-2 border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
												<div>SIDE</div>
												<div>COIN</div>
												<div className="text-right">ENTRY</div>
												<div className="text-right">NOTIONAL</div>
												<div className="text-center">ACTION</div>
											</div>

											{modelPos.positions.map((position, idx) => {
												const signal = position.signal ?? position.sign;

												return (
													<div
														key={`${modelPos.modelId}-${position.symbol}-${idx}`}
														className={`grid grid-cols-5 gap-x-2 px-4 py-2.5 text-[0.7rem] transition-colors hover:bg-accent/20 ${
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
														<div className="flex items-center justify-end whitespace-nowrap">
															<span className="font-bold tabular-nums text-muted-foreground">
																{position.entryPrice
																	? formatCurrencyValue(
																			String(position.entryPrice),
																		)
																	: "—"}
															</span>
														</div>

														<div className="flex items-center justify-end whitespace-nowrap">
															<span className="font-bold tabular-nums text-green-500">
																{formatCurrencyValue(position.notional)}
															</span>
														</div>
														<div className="flex items-center justify-center whitespace-nowrap">
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
														</div>
													</div>
												);
											})}
										</div>
										{modelIdx < enrichedPositions.length - 1 && (
											<div className="h-2" />
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
function renderSymbolIcon(symbol: string) {
	const normalized = symbol.toUpperCase();
	if (!isSupportedMarketSymbol(normalized)) {
		return <span className="text-lg">●</span>;
	}

	const market = MARKETS[normalized];
	return (
		<img
			src={market.logo}
			alt={market.badge}
			width={16}
			height={16}
			className="h-4 w-4"
			style={{ objectFit: "contain" }}
			loading="lazy"
		/>
	);
}
