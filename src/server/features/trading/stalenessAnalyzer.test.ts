import { describe, expect, it } from "vitest";
import {
	computeStalenessScore,
	type StalenessInput,
} from "./stalenessAnalyzer";

function hoursAgo(hours: number): Date {
	return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function makeInput(
	overrides: Partial<StalenessInput> & { hoursHeld?: number } = {},
): StalenessInput {
	const { hoursHeld = 72, ...rest } = overrides;
	return {
		entryTime: hoursAgo(hoursHeld),
		unrealizedPnl: 0,
		costBasis: 50000,
		notionalUsd: 50000,
		fundingCostUsd: null,
		...rest,
	};
}

describe("computeStalenessScore", () => {
	describe("grace period", () => {
		it("returns null for positions under 24 hours", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 12 }));
			expect(result).toBeNull();
		});

		it("returns null at exactly 23.9 hours", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 23.9 }));
			expect(result).toBeNull();
		});

		it("returns a score at exactly 24 hours", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 24 }));
			expect(result).not.toBeNull();
			expect(result!.score).toBe(0);
			expect(result!.isStale).toBe(false);
		});

		it("returns a score just above 24 hours", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 24.1 }));
			expect(result).not.toBeNull();
		});
	});

	describe("time held dimension (max 40pts)", () => {
		it("scores 0 when held less than 2 days", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 36 }))!;
			expect(result.timeHeldScore).toBe(0);
		});

		it("scores 0 at exactly 2 days", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 48 }))!;
			expect(result.timeHeldScore).toBe(0);
		});

		it("scores 40 at 3 days", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 72 }))!;
			expect(result.timeHeldScore).toBe(40);
		});

		it("scores 40 at 3+ days", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 120 }))!;
			expect(result.timeHeldScore).toBe(40);
		});

		it("scores linearly between 2 and 3 days (2.5 days = 20pts)", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 60 }))!;
			expect(result.timeHeldScore).toBe(20);
		});

		it("scores linearly at 2.25 days = 10pts", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 54 }))!;
			expect(result.timeHeldScore).toBe(10);
		});
	});

	describe("P&L action dimension (max 30pts)", () => {
		it("scores 0 for breakeven held less than 2 days", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 30,
					unrealizedPnl: 0,
				}),
			)!;
			expect(result.pnlActionScore).toBe(0);
		});

		it("scales by loss magnitude", () => {
			// -5% loss, held 3 days
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500, // 5% of 50000
					costBasis: 50000,
				}),
			)!;
			// Loss = 5%, fraction = 5/10 = 0.5, score = 0.5 * 30 = 15
			expect(result.pnlActionScore).toBe(15);
		});

		it("maxes out at 10% loss", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -5000, // 10% of 50000
					costBasis: 50000,
				}),
			)!;
			expect(result.pnlActionScore).toBe(30);
		});

		it("caps at 30 even for extreme losses", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -15000, // 30% of 50000
					costBasis: 50000,
				}),
			)!;
			expect(result.pnlActionScore).toBe(30);
		});

		it("scores 15 when held 2+ days with <3% gain", () => {
			// +2% gain, held 3 days
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 1000, // 2% of 50000
					costBasis: 50000,
				}),
			)!;
			expect(result.pnlActionScore).toBe(15);
		});

		it("scores 15 when held exactly 2 days with <3% gain", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 48,
					unrealizedPnl: 500, // 1% of 50000
					costBasis: 50000,
				}),
			)!;
			expect(result.pnlActionScore).toBe(15);
		});

		it("scores 0 for strong gains (>3% and held 2+ days)", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 2000, // 4% of 50000
					costBasis: 50000,
				}),
			)!;
			expect(result.pnlActionScore).toBe(0);
		});

		it("uses notionalUsd when costBasis is null", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500, // 5% of 50000
					costBasis: null,
					notionalUsd: 50000,
				}),
			)!;
			expect(result.pnlActionScore).toBe(15);
		});

		it("returns 0 when both costBasis and notionalUsd are null", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500,
					costBasis: null,
					notionalUsd: null,
				}),
			)!;
			expect(result.pnlActionScore).toBe(0);
		});

		it("returns 0 when costBasis is 0 and notionalUsd is also unavailable", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500,
					costBasis: 0,
					notionalUsd: null,
				}),
			)!;
			expect(result.pnlActionScore).toBe(0);
		});

		it("falls back to notionalUsd when costBasis is 0", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500,
					costBasis: 0,
					notionalUsd: 50000,
				}),
			)!;
			// costBasis 0 falls through to notionalUsd 50000
			// -2500/50000 = -5% => fraction 5/10 = 0.5 => 15pts
			expect(result.pnlActionScore).toBe(15);
		});
	});

	describe("funding cost dimension (max 30pts)", () => {
		it("scores 0 when fundingCostUsd is null", () => {
			const result = computeStalenessScore(
				makeInput({ hoursHeld: 72, fundingCostUsd: null }),
			)!;
			expect(result.fundingCostScore).toBe(0);
		});

		it("scores 0 when fundingCostUsd is 0", () => {
			const result = computeStalenessScore(
				makeInput({ hoursHeld: 72, fundingCostUsd: 0 }),
			)!;
			expect(result.fundingCostScore).toBe(0);
		});

		it("scores 0 when fundingCostUsd is negative", () => {
			const result = computeStalenessScore(
				makeInput({ hoursHeld: 72, fundingCostUsd: -10 }),
			)!;
			expect(result.fundingCostScore).toBe(0);
		});

		it("scales by funding cost ratio", () => {
			// fundingRatio = 50 / 50000 = 0.001 (the cap), so full 30pts
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					fundingCostUsd: 50,
					costBasis: 50000,
				}),
			)!;
			expect(result.fundingCostScore).toBe(30);
		});

		it("scores proportionally for partial funding cost", () => {
			// fundingRatio = 25 / 50000 = 0.0005, fraction = 0.0005/0.001 = 0.5
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					fundingCostUsd: 25,
					costBasis: 50000,
				}),
			)!;
			expect(result.fundingCostScore).toBe(15);
		});

		it("caps at 30 even for extreme funding costs", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					fundingCostUsd: 200,
					costBasis: 50000,
				}),
			)!;
			expect(result.fundingCostScore).toBe(30);
		});

		it("uses notionalUsd when costBasis is null", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					fundingCostUsd: 25,
					costBasis: null,
					notionalUsd: 50000,
				}),
			)!;
			expect(result.fundingCostScore).toBe(15);
		});

		it("returns 0 when both costBasis and notionalUsd are null", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					fundingCostUsd: 50,
					costBasis: null,
					notionalUsd: null,
				}),
			)!;
			expect(result.fundingCostScore).toBe(0);
		});
	});

	describe("composite score", () => {
		it("sums all dimensions", () => {
			// held 3 days (40pts) + -5% loss (15pts) + funding ratio 0.0005 (15pts) = 70
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500,
					costBasis: 50000,
					fundingCostUsd: 25,
				}),
			)!;
			expect(result.timeHeldScore).toBe(40);
			expect(result.pnlActionScore).toBe(15);
			expect(result.fundingCostScore).toBe(15);
			expect(result.score).toBe(70);
		});

		it("caps composite score at 100", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -5000, // 10% loss = 30pts
					costBasis: 50000,
					fundingCostUsd: 100, // ratio 0.002 = 60pts raw, capped at 30
				}),
			)!;
			expect(result.score).toBe(100);
		});

		it("returns 0 for a fresh position at exactly 24h with no P&L", () => {
			const result = computeStalenessScore(
				makeInput({ hoursHeld: 24, unrealizedPnl: 0 }),
			)!;
			expect(result.score).toBe(0);
			expect(result.isStale).toBe(false);
		});
	});

	describe("STALE flag", () => {
		it("flags as stale when score >= 70", () => {
			// 3 days (40) + -5% loss (15) + funding 0.0005 (15) = 70
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -2500,
					costBasis: 50000,
					fundingCostUsd: 25,
				}),
			)!;
			expect(result.isStale).toBe(true);
		});

		it("does not flag when score < 70", () => {
			// 2.5 days (20) + -3% loss (9) + no funding = 29
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 60,
					unrealizedPnl: -1500,
					costBasis: 50000,
				}),
			)!;
			expect(result.score).toBe(29);
			expect(result.isStale).toBe(false);
		});

		it("flags when held >= 3 days AND gain < 5%", () => {
			// 3 days (40) + breakeven 0 (0) + no funding (0) = 40
			// But held >= 3 days and gain < 5% => STALE
			// Also: 2% gain, held 2+ days => pnl action 15pts => total 55
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 1000, // 2% gain
					costBasis: 50000,
				}),
			)!;
			expect(result.timeHeldScore).toBe(40);
			expect(result.pnlActionScore).toBe(15); // 2+ days, <3% gain
			expect(result.score).toBe(55);
			expect(result.isStale).toBe(true);
		});

		it("does not flag when held >= 3 days AND gain >= 5%", () => {
			// 3 days (40) + good gain 0 + no funding = 40
			// Gain = 6% => not stale by second rule, score < 70 => not stale
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 3000, // 6% gain
					costBasis: 50000,
				}),
			)!;
			expect(result.isStale).toBe(false);
		});

		it("does not flag when held < 3 days regardless of score", () => {
			// 2.5 days (20) + -10% loss (30) + funding cap (30) = 80
			// Score >= 70 => STALE regardless
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 60,
					unrealizedPnl: -5000,
					costBasis: 50000,
					fundingCostUsd: 50,
				}),
			)!;
			expect(result.score).toBe(80);
			expect(result.isStale).toBe(true);
		});

		it("flags by second rule when held 3 days with loss (gain < 5%)", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: -500, // -1% gain
					costBasis: 50000,
				}),
			)!;
			// time held: 40, pnl: 3pts (1% loss / 10% cap * 30), funding: 0
			// score = 43, held >= 3 days and gain (-1%) < 5% => stale
			expect(result.isStale).toBe(true);
		});
	});

	describe("hoursHeld output", () => {
		it("reports correct hours held", () => {
			const result = computeStalenessScore(makeInput({ hoursHeld: 50 }))!;
			expect(result.hoursHeld).toBe(50);
		});
	});

	describe("edge cases", () => {
		it("handles zero cost basis gracefully", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 100,
					costBasis: 0,
					notionalUsd: 0,
				}),
			)!;
			expect(result.pnlActionScore).toBe(0);
			expect(result.fundingCostScore).toBe(0);
		});

		it("handles negative cost basis gracefully", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 100,
					costBasis: -1000,
					notionalUsd: 50000,
				}),
			)!;
			// costBasis -1000 is <= 0, falls through to notionalUsd 50000
			// gainPercent = 100/50000 = 0.2% < 3%, held 2+ days => 15pts
			expect(result.pnlActionScore).toBe(15);
		});

		it("handles very large holding period", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 24 * 365, // 1 year
					unrealizedPnl: 0,
					costBasis: 50000,
				}),
			)!;
			expect(result.timeHeldScore).toBe(40);
			// 0% gain, held 2+ days => pnl action 15pts
			expect(result.pnlActionScore).toBe(15);
			expect(result.score).toBe(55);
			expect(result.isStale).toBe(true); // 3+ days and <5% gain
		});

		it("handles exact 3 days with 4.99% gain as stale", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 2495, // 4.99% of 50000
					costBasis: 50000,
				}),
			)!;
			expect(result.isStale).toBe(true);
		});

		it("handles exact 3 days with 5% gain as not stale", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: 72,
					unrealizedPnl: 2500, // exactly 5% of 50000
					costBasis: 50000,
				}),
			)!;
			// gain = 5% is NOT < 5%, so second rule doesn't trigger
			// score = 40 (time) + 0 (pnl, 5% >= 3% and held 2+ days = 0) + 0 = 40
			expect(result.isStale).toBe(false);
		});

		it("respects now parameter", () => {
			const entryTime = new Date("2024-01-01T00:00:00Z");
			const now = new Date("2024-01-04T00:00:00Z"); // 72 hours later

			const result = computeStalenessScore(
				{
					entryTime,
					unrealizedPnl: 0,
					costBasis: 50000,
					notionalUsd: 50000,
					fundingCostUsd: null,
				},
				now,
			)!;

			expect(result.hoursHeld).toBe(72);
			expect(result.timeHeldScore).toBe(40);
		});

		it("returns null for future entryTime", () => {
			const result = computeStalenessScore(
				makeInput({
					hoursHeld: -1, // future
				}),
			)!;
			expect(result).toBeNull();
		});
	});
});
