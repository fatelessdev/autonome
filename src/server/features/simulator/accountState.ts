import type {
	AccountSnapshot,
	ExchangeSimulatorOptions,
	OrderExecution,
	OrderSide,
	PositionExitPlan,
	PositionSummary,
} from "@/server/features/simulator/types";

interface PositionInternal {
	quantity: number;
	avgEntryPrice: number;
	realizedPnl: number;
	markPrice: number;
	margin: number;
	exitPlan: PositionExitPlan | null;
	autoClosePending?: boolean;
}

export class AccountState {
	private static readonly CASH_EPSILON = 1e-6;
	private static readonly MARGIN_EPSILON = 1e-6;
	private cashBalance: number;
	private readonly quoteCurrency: string;
	private readonly positions = new Map<string, PositionInternal>();
	private totalRealized = 0;
	private totalFees = 0;
	private totalFunding = 0;

	constructor(private readonly options: ExchangeSimulatorOptions) {
		this.cashBalance = options.initialCapital;
		this.quoteCurrency = options.quoteCurrency;
	}

	private clone(): AccountState {
		const copy = new AccountState(this.options);
		copy.cashBalance = this.cashBalance;
		copy.totalRealized = this.totalRealized;
		copy.totalFees = this.totalFees;
		copy.totalFunding = this.totalFunding;
		copy.positions.clear();
		for (const [symbol, position] of this.positions.entries()) {
			copy.positions.set(symbol, {
				...position,
				exitPlan: position.exitPlan ? { ...position.exitPlan } : null,
			});
		}
		return copy;
	}

	private calculateTotalMargin(): number {
		let total = 0;
		for (const position of this.positions.values()) {
			if (!Number.isFinite(position.margin)) continue;
			total += Math.max(position.margin, 0);
		}
		return total;
	}

	private computeEquityValue(): number {
		let netPositionValue = 0;
		for (const position of this.positions.values()) {
			netPositionValue += position.markPrice * position.quantity;
		}
		return this.cashBalance + netPositionValue;
	}

	private resolveLeverage(
		leverage: number | null | undefined,
		position: PositionInternal | undefined,
		referencePrice: number,
	): number {
		if (
			typeof leverage === "number" &&
			Number.isFinite(leverage) &&
			leverage > 0
		) {
			return Math.max(leverage, 1);
		}

		if (position && Math.abs(position.quantity) > AccountState.MARGIN_EPSILON) {
			const margin = Number.isFinite(position.margin) ? position.margin : 0;
			if (margin > AccountState.MARGIN_EPSILON) {
				const price = position.avgEntryPrice || referencePrice;
				if (price > 0) {
					const notional = Math.abs(position.quantity) * price;
					if (notional > 0) {
						return Math.max(notional / margin, 1);
					}
				}
			}
		}

		return 1;
	}

	hasSufficientCash(
		symbol: string,
		side: OrderSide,
		execution: OrderExecution,
		leverage?: number | null,
	): boolean {
		if (execution.status === "rejected" || execution.totalQuantity === 0) {
			return true;
		}

		const preview = this.clone();
		preview.applyExecution(symbol, side, execution, leverage);

		const projectedEquity = preview.computeEquityValue();
		const projectedMargin = preview.calculateTotalMargin();

		return projectedEquity + AccountState.CASH_EPSILON >= projectedMargin;
	}

	applyExecution(
		symbol: string,
		side: OrderSide,
		execution: OrderExecution,
		leverage?: number | null,
	) {
		if (execution.status === "rejected" || execution.totalQuantity === 0) {
			return;
		}

		const direction = side === "buy" ? 1 : -1;
		let position = this.positions.get(symbol);
		if (!position) {
			position = {
				quantity: 0,
				avgEntryPrice: 0,
				realizedPnl: 0,
				markPrice: execution.fills[0]?.price ?? 0,
				margin: 0,
				exitPlan: null,
			};
		} else if (!Number.isFinite(position.margin)) {
			const referencePrice = position.avgEntryPrice || position.markPrice;
			const inferredNotional =
				referencePrice && referencePrice > 0
					? Math.abs(position.quantity) * referencePrice
					: 0;
			position.margin = inferredNotional;
		}

		for (const fill of execution.fills) {
			const signedQty = direction * fill.quantity;
			const notional = fill.quantity * fill.price;
			const leverageFactor = this.resolveLeverage(
				leverage,
				position,
				fill.price,
			);
			const startingQuantity = position.quantity;

			this.cashBalance -= signedQty * fill.price;
			this.cashBalance -= fill.fee;

			if (
				startingQuantity === 0 ||
				Math.sign(startingQuantity) === Math.sign(signedQty)
			) {
				const totalQty = startingQuantity + signedQty;
				const prevNotional =
					position.avgEntryPrice * Math.abs(startingQuantity);
				const newNotional = fill.price * Math.abs(signedQty);
				position.quantity = totalQty;
				position.avgEntryPrice =
					totalQty !== 0
						? (prevNotional + newNotional) / Math.abs(totalQty)
						: 0;
				position.margin += notional / leverageFactor;
			} else {
				const existingAbs = Math.abs(startingQuantity);
				const closingQty = Math.min(existingAbs, Math.abs(signedQty));

				if (existingAbs > 0) {
					const marginRelease = position.margin * (closingQty / existingAbs);
					position.margin -= marginRelease;
					if (Math.abs(position.margin) < AccountState.MARGIN_EPSILON) {
						position.margin = 0;
					}
				}

				const realized =
					startingQuantity > 0
						? (fill.price - position.avgEntryPrice) * closingQty
						: (position.avgEntryPrice - fill.price) * closingQty;

				position.realizedPnl += realized;
				this.totalRealized += realized;

				const remainingQty = startingQuantity + signedQty;

				if (remainingQty === 0) {
					position.quantity = 0;
					position.avgEntryPrice = 0;
					position.margin = 0;
				} else if (Math.sign(remainingQty) === Math.sign(startingQuantity)) {
					position.quantity = remainingQty;
				} else {
					const openedQty = Math.abs(remainingQty);
					const marginForFlip = (openedQty * fill.price) / leverageFactor;
					position.quantity = remainingQty;
					position.avgEntryPrice = fill.price;
					position.margin = marginForFlip;
				}
			}

			position.markPrice = fill.price;
			this.totalFees += fill.fee;

			if (!Number.isFinite(position.margin) || position.margin < 0) {
				position.margin = 0;
			}

			if (position.quantity === 0 && Math.abs(position.realizedPnl) < 0.01) {
				this.positions.delete(symbol);
			} else {
				if (position.quantity === 0) {
					position.exitPlan = null;
					position.autoClosePending = false;
				}
				this.positions.set(symbol, position);
			}
		}
	}

	updateMarkPrice(symbol: string, markPrice: number) {
		const position = this.positions.get(symbol);
		if (!position) return;
		position.markPrice = markPrice;
	}

	applyFunding(symbol: string, effectiveRate: number) {
		if (!Number.isFinite(effectiveRate) || effectiveRate === 0) {
			return;
		}

		const position = this.positions.get(symbol);
		if (!position || position.quantity === 0) {
			return;
		}

		const markPrice = position.markPrice;
		if (!Number.isFinite(markPrice) || markPrice <= 0) {
			return;
		}

		const notional = Math.abs(position.quantity) * markPrice;
		if (notional === 0) {
			return;
		}

		const direction = Math.sign(position.quantity) || 1;
		const fundingPnl = -direction * notional * effectiveRate;
		if (fundingPnl === 0) {
			return;
		}

		this.cashBalance += fundingPnl;
		position.realizedPnl += fundingPnl;
		this.totalRealized += fundingPnl;
		this.totalFunding += fundingPnl;
	}

	getSnapshot(): AccountSnapshot {
		const positions: PositionSummary[] = [];
		let unrealizedTotal = 0;
		let netPositionValue = 0;
		let totalMargin = 0;

		for (const [symbol, position] of this.positions.entries()) {
			if (position.quantity === 0) continue;

			const side = position.quantity >= 0 ? "LONG" : "SHORT";
			const absoluteQuantity = Math.abs(position.quantity);

			const unrealized =
				side === "LONG"
					? (position.markPrice - position.avgEntryPrice) * absoluteQuantity
					: (position.avgEntryPrice - position.markPrice) * absoluteQuantity;
			unrealizedTotal += unrealized;

			netPositionValue += position.markPrice * position.quantity;

			const marginUsed = Number.isFinite(position.margin)
				? Math.max(position.margin, 0)
				: 0;
			totalMargin += marginUsed;
			const referencePrice = position.avgEntryPrice || position.markPrice;
			const price =
				referencePrice && referencePrice > 0
					? referencePrice
					: position.markPrice;
			const notional = price > 0 ? Math.abs(position.quantity) * price : 0;
			const leverage =
				marginUsed > AccountState.MARGIN_EPSILON && notional > 0
					? notional / marginUsed
					: null;

			positions.push({
				symbol,
				quantity: absoluteQuantity,
				side,
				avgEntryPrice: position.avgEntryPrice,
				realizedPnl: position.realizedPnl,
				unrealizedPnl: unrealized,
				markPrice: position.markPrice,
				margin: marginUsed,
				notional,
				leverage,
				exitPlan: position.exitPlan ? { ...position.exitPlan } : null,
			});
		}

		const equity = this.cashBalance + netPositionValue;
		const borrowedBalance = Math.max(-this.cashBalance, 0);
		const availableCash = Math.max(equity - totalMargin, 0);

		return {
			cashBalance: this.cashBalance,
			availableCash,
			borrowedBalance,
			equity,
			marginBalance: totalMargin,
			quoteCurrency: this.quoteCurrency,
			positions,
			totalRealizedPnl: this.totalRealized,
			totalUnrealizedPnl: unrealizedTotal,
			totalFundingPnl: this.totalFunding,
		};
	}

	getOpenPositions(): PositionSummary[] {
		return this.getSnapshot().positions;
	}

	setExitPlan(symbol: string, exitPlan: PositionExitPlan | null) {
		const position = this.positions.get(symbol);
		if (!position) return;
		position.exitPlan = exitPlan ? { ...exitPlan } : null;
		position.autoClosePending = false;
	}

	collectExitPlanTriggers(): { symbol: string; trigger: "STOP" | "TARGET" }[] {
		const triggers: { symbol: string; trigger: "STOP" | "TARGET" }[] = [];

		for (const [symbol, position] of this.positions.entries()) {
			if (position.quantity === 0 || position.autoClosePending) {
				continue;
			}

			const exitPlan = position.exitPlan;
			if (!exitPlan) continue;

			const markPrice = position.markPrice;
			if (!Number.isFinite(markPrice) || markPrice <= 0) continue;

			const isLong = position.quantity > 0;
			const stop = exitPlan.stop;
			const target = exitPlan.target;

			if (isLong) {
				if (stop != null && markPrice <= stop) {
					position.autoClosePending = true;
					triggers.push({ symbol, trigger: "STOP" });
					continue;
				}
				if (target != null && markPrice >= target) {
					position.autoClosePending = true;
					triggers.push({ symbol, trigger: "TARGET" });
				}
			} else {
				if (stop != null && markPrice >= stop) {
					position.autoClosePending = true;
					triggers.push({ symbol, trigger: "STOP" });
					continue;
				}
				if (target != null && markPrice <= target) {
					position.autoClosePending = true;
					triggers.push({ symbol, trigger: "TARGET" });
				}
			}
		}

		return triggers;
	}

	clearPendingExit(symbol: string) {
		const position = this.positions.get(symbol);
		if (!position) return;
		position.autoClosePending = false;
	}
}
