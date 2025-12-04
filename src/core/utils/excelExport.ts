/**
 * Excel Export Utility
 * Uses SheetJS (xlsx) for proper Excel file generation with multiple sheets
 */

import * as XLSX from "xlsx";
import type { OverallStats, AdvancedStats } from "@/server/features/analytics/types";

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