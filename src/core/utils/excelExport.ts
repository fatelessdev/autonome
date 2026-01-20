/**
 * Excel Export Utility
 * Uses SheetJS (xlsx) for proper Excel file generation with multiple sheets
 */

import * as XLSX from "xlsx";
import type { OverallStats, AdvancedStats } from "@/server/features/analytics/types";
import { VARIANT_IDS } from "@/core/shared/variants";

/**
 * Leaderboard entry for export
 */
export interface LeaderboardEntry {
	modelName: string;
	variant: string;
	pnlPercent: number;
	pnlAbsolute: number;
	maxDrawdown: number;
	startValue: number;
	endValue: number;
}

/**
 * Leaderboard data for each variant
 */
export interface LeaderboardVariantData {
	variant: string;
	entries: LeaderboardEntry[];
}

/**
 * Format hold time in minutes to human-readable string
 */
function formatHoldTime(minutes: number): string {
	if (!isFinite(minutes) || minutes < 0) return "0m";
	if (minutes < 60) return `${Math.round(minutes)}m`;
	if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
	return `${(minutes / 1440).toFixed(1)}d`;
}

/**
 * Calculate running hours from start time to now
 */
function calculateRunningHours(runStartTime: Date | null): string {
	if (!runStartTime) return "00h";
	const now = new Date();
	const diffMs = now.getTime() - runStartTime.getTime();
	const hours = Math.floor(diffMs / (1000 * 60 * 60));
	return `${hours.toString().padStart(2, "0")}h`;
}

/**
 * Export analytics data to Excel with two sheets: Overall and Advanced
 * Filename format: YYYY-MM-DD_XXh_Autonome.xlsx
 */
export function exportAnalyticsToExcel(
	overallStats: OverallStats[],
	advancedStats: AdvancedStats[],
	runStartTime: Date | null,
): void {
	const timestamp = new Date().toISOString().slice(0, 10);
	const runningHours = calculateRunningHours(runStartTime);

	// Create workbook
	const wb = XLSX.utils.book_new();

	// Overall Stats sheet
	const overallData = [
		[
			"Model",
			"Variant",
			"Account Value ($)",
			"Return %",
			"Total P&L ($)",
			"Win Rate %",
			"Biggest Win ($)",
			"Biggest Loss ($)",
			"Sharpe Ratio",
			"Trades Count",
		],
		...overallStats.map((stat) => [
			stat.modelName,
			stat.variant ?? "Unknown",
			stat.accountValue,
			stat.returnPercent,
			stat.totalPnl,
			stat.winRate,
			stat.biggestWin,
			stat.biggestLoss,
			stat.sharpeRatio,
			stat.tradesCount,
		]),
	];
	const overallSheet = XLSX.utils.aoa_to_sheet(overallData);
	XLSX.utils.book_append_sheet(wb, overallSheet, "Overall Stats");

	// Advanced Stats sheet
	const advancedData = [
		[
			"Model",
			"Variant",
			"Account Value ($)",
			"Avg Trade Size ($)",
			"Median Trade Size ($)",
			"Max Trade Size ($)",
			"Avg Hold Time",
			"Median Hold Time",
			"Max Hold Time",
			"Long %",
			"Expectancy ($)",
			"Avg Leverage",
			"Median Leverage",
			"Max Leverage",
			"Avg Confidence %",
			"Median Confidence %",
			"Max Confidence %",
			"Failed Workflows",
			"Failed Tool Calls",
			"Invocation Count",
			"Failure Rate %",
		],
		...advancedStats.map((stat) => [
			stat.modelName,
			stat.variant ?? "Unknown",
			stat.accountValue,
			stat.avgTradeSize,
			stat.medianTradeSize,
			stat.maxTradeSize,
			formatHoldTime(stat.avgHoldTimeMinutes),
			formatHoldTime(stat.medianHoldTimeMinutes),
			formatHoldTime(stat.maxHoldTimeMinutes),
			stat.longPercent,
			stat.expectancy,
			stat.avgLeverage,
			stat.medianLeverage,
			stat.maxLeverage,
			stat.avgConfidence,
			stat.medianConfidence,
			stat.maxConfidence,
			stat.failedWorkflowCount,
			stat.failedToolCallCount,
			stat.invocationCount,
			stat.failureRate,
		]),
	];
	const advancedSheet = XLSX.utils.aoa_to_sheet(advancedData);
	XLSX.utils.book_append_sheet(wb, advancedSheet, "Advanced Stats");

	// Generate binary and trigger download
	const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
	const blob = new Blob([wbout], {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});

	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${timestamp}_${runningHours}_Autonome.xlsx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/**
 * Create a leaderboard data sheet
 */
function createLeaderboardSheet(
	entries: LeaderboardEntry[],
	includeVariant: boolean,
): XLSX.WorkSheet {
	const headers = includeVariant
		? ["Model", "Variant", "PnL %", "PnL $", "Max Drawdown %", "Start Value $", "End Value $"]
		: ["Model", "PnL %", "PnL $", "Max Drawdown %", "Start Value $", "End Value $"];

	const data = [
		headers,
		...entries.map((entry) =>
			includeVariant
				? [
						entry.modelName,
						entry.variant,
						entry.pnlPercent,
						entry.pnlAbsolute,
						entry.maxDrawdown,
						entry.startValue,
						entry.endValue,
					]
				: [
						entry.modelName,
						entry.pnlPercent,
						entry.pnlAbsolute,
						entry.maxDrawdown,
						entry.startValue,
						entry.endValue,
					],
		),
	];

	return XLSX.utils.aoa_to_sheet(data);
}

/**
 * Calculate averaged entries across variants for each model
 */
function calculateAverageEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
	const byModelName = new Map<string, LeaderboardEntry[]>();
	
	for (const entry of entries) {
		const existing = byModelName.get(entry.modelName) ?? [];
		existing.push(entry);
		byModelName.set(entry.modelName, existing);
	}

	return Array.from(byModelName.entries()).map(([modelName, modelEntries]) => {
		const avgPnlPercent = modelEntries.reduce((sum, e) => sum + e.pnlPercent, 0) / modelEntries.length;
		const avgPnlAbsolute = modelEntries.reduce((sum, e) => sum + e.pnlAbsolute, 0) / modelEntries.length;
		const avgMaxDrawdown = modelEntries.reduce((sum, e) => sum + e.maxDrawdown, 0) / modelEntries.length;
		const avgStartValue = modelEntries.reduce((sum, e) => sum + e.startValue, 0) / modelEntries.length;
		const avgEndValue = modelEntries.reduce((sum, e) => sum + e.endValue, 0) / modelEntries.length;

		return {
			modelName,
			variant: "AVG",
			pnlPercent: avgPnlPercent,
			pnlAbsolute: avgPnlAbsolute,
			maxDrawdown: avgMaxDrawdown,
			startValue: avgStartValue,
			endValue: avgEndValue,
		};
	}).sort((a, b) => b.pnlPercent - a.pnlPercent);
}

/**
 * Export leaderboard data to Excel with separate sheets for each variant:
 * 1. Situational
 * 2. Minimal
 * 3. Guardian
 * 4. Max
 * 5. Sovereign
 * 6. All Models - All models across all variants
 * 7. Average - Averaged stats per model across variants
 * 
 * Filename format: YYYY-MM-DD_Leaderboard_{window}.xlsx
 */
export function exportLeaderboardToExcel(
	variantData: LeaderboardVariantData[],
	window: string,
): void {
	const timestamp = new Date().toISOString().slice(0, 10);

	// Create workbook
	const wb = XLSX.utils.book_new();

	// Add a sheet for each variant
	for (const variant of VARIANT_IDS) {
		const data = variantData.find((d) => d.variant === variant);
		if (data && data.entries.length > 0) {
			const sheet = createLeaderboardSheet(data.entries, false);
			XLSX.utils.book_append_sheet(wb, sheet, variant);
		}
	}

	// All Models sheet - combine all variants
	const allEntries = variantData.flatMap((d) => d.entries);
	if (allEntries.length > 0) {
		const allSheet = createLeaderboardSheet(allEntries, true);
		XLSX.utils.book_append_sheet(wb, allSheet, "All Models");
	}

	// Average sheet - averaged stats per model
	if (allEntries.length > 0) {
		const avgEntries = calculateAverageEntries(allEntries);
		const avgSheet = createLeaderboardSheet(avgEntries, false);
		XLSX.utils.book_append_sheet(wb, avgSheet, "Average");
	}

	// Generate binary and trigger download
	const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
	const blob = new Blob([wbout], {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});

	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${timestamp}_Leaderboard_${window}.xlsx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}