/**
 * Shared Variant Constants & Utilities
 *
 * Single Source of Truth for all variant-related definitions.
 * This module is consumed by:
 * - Database schema (variantEnum)
 * - oRPC router schemas (Zod validation)
 * - Frontend components (styling, filtering)
 * - Seed scripts
 * - Export utilities
 *
 * To add a new variant:
 * 1. Add it to VARIANT_IDS array below
 * 2. Add its config to VARIANT_CONFIG
 * 3. Run `bun run db:generate && bun run db:migrate`
 */

import { z } from "zod";

// ==================== Core Variant IDs ====================

/**
 * All variant IDs in display order.
 * This is the SSOT - all other variant lists derive from this.
 */
export const VARIANT_IDS = [
	"Guardian",
	"Apex",
	"Gladiator",
	"Sniper",
	"Trendsurfer",
	"Contrarian",
	"Sovereign",
] as const;

/**
 * TypeScript type derived from the SSOT array
 */
export type VariantId = (typeof VARIANT_IDS)[number];

/**
 * Extended type that includes "all" for aggregate filtering
 */
export type VariantIdWithAll = VariantId | "all";

// ==================== Zod Schemas ====================

/**
 * Zod schema for validating variant IDs.
 * Use this in all oRPC procedures and form validation.
 */
export const variantIdSchema = z.enum(VARIANT_IDS);

/**
 * Optional variant schema for filter inputs
 */
export const variantIdOptionalSchema = variantIdSchema.optional();

/**
 * Variant with "all" option for aggregate queries
 */
export const variantIdWithAllSchema = z.enum(["all", ...VARIANT_IDS]);

// ==================== Variant Configuration ====================

export interface VariantConfig {
	/** Unique variant identifier */
	id: VariantId;
	/** Display label for UI */
	label: string;
	/** Short description of the strategy */
	description: string;
	/** Hex color for charts/badges */
	color: string;
	/** Tailwind background color class (with opacity) */
	bgClass: string;
	/** Tailwind text color class */
	textClass: string;
	/** Light mode background for tabs/cards */
	lightBg: string;
}

/**
 * Full configuration for each variant including styling.
 * Colors match Tailwind's palette for consistency.
 */
export const VARIANT_CONFIG: Record<VariantId, VariantConfig> = {
	Guardian: {
		id: "Guardian",
		label: "Guardian (Fortress)",
		description: "Capital preservation, Ichimoku Cloud hard filter, ADX safety",
		color: "#a855f7", // purple-500
		bgClass: "bg-purple-500/20",
		textClass: "text-purple-600",
		lightBg: "#faf5ff",
	},
	Apex: {
		id: "Apex",
		label: "Apex (Kelly Engine)",
		description: "Aggressive 10x leverage, VWAP momentum validation, squeeze trading",
		color: "#f59e0b", // amber-500
		bgClass: "bg-amber-500/20",
		textClass: "text-amber-600",
		lightBg: "#fffbeb",
	},
	Gladiator: {
		id: "Gladiator",
		label: "Gladiator (Tournament)",
		description: "Game theory based, leaderboard-aware attack/defend posture",
		color: "#22c55e", // green-500
		bgClass: "bg-green-500/20",
		textClass: "text-green-600",
		lightBg: "#f0fdf4",
	},
	Sniper: {
		id: "Sniper",
		label: "Sniper (Precision)",
		description: "Confluence specialist, Rule of Three, VWAP + RSI + Pattern",
		color: "#3b82f6", // blue-500
		bgClass: "bg-blue-500/20",
		textClass: "text-blue-600",
		lightBg: "#eff6ff",
	},
	Trendsurfer: {
		id: "Trendsurfer",
		label: "Trendsurfer (Momentum)",
		description: "Trend follower, ADX > 25 filter, Kijun-Sen trailing stops",
		color: "#06b6d4", // cyan-500
		bgClass: "bg-cyan-500/20",
		textClass: "text-cyan-600",
		lightBg: "#ecfeff",
	},
	Contrarian: {
		id: "Contrarian",
		label: "Contrarian (Reverter)",
		description: "Mean reversion in ranging markets, ADX < 25, fade to VWAP",
		color: "#e11d48", // rose-600
		bgClass: "bg-rose-500/20",
		textClass: "text-rose-600",
		lightBg: "#fff1f2",
	},
	Sovereign: {
		id: "Sovereign",
		label: "Sovereign (Adaptive)",
		description: "Flexible regime-adaptive allocator, blends trend & range strategies",
		color: "#eab308", // yellow-500
		bgClass: "bg-yellow-500/20",
		textClass: "text-yellow-600",
		lightBg: "#fefce8",
	},
};

// ==================== Helper Functions ====================

/**
 * Get variant configuration by ID.
 * Throws if variant ID is invalid.
 */
export function getVariantConfig(variantId: VariantId): VariantConfig {
	const config = VARIANT_CONFIG[variantId];
	if (!config) {
		throw new Error(`Unknown variant ID: ${variantId}`);
	}
	return config;
}

/**
 * Get all variant configs as array (in display order)
 */
export function getAllVariantConfigs(): VariantConfig[] {
	return VARIANT_IDS.map((id) => VARIANT_CONFIG[id]);
}

/**
 * Check if a string is a valid variant ID
 */
export function isValidVariantId(value: unknown): value is VariantId {
	return typeof value === "string" && VARIANT_IDS.includes(value as VariantId);
}

/**
 * Safely cast a string to VariantId, returning undefined if invalid
 */
export function toVariantId(value: unknown): VariantId | undefined {
	return isValidVariantId(value) ? value : undefined;
}

// ==================== Tailwind Style Helpers ====================

/**
 * Get Tailwind classes for a variant badge/pill.
 * Returns combined bg + text classes.
 *
 * @example
 * <span className={cn("px-2 py-0.5 rounded text-xs font-medium", getVariantBadgeClasses("Guardian"))}>
 *   Guardian
 * </span>
 */
export function getVariantBadgeClasses(variant: VariantId | string | undefined): string {
	if (!variant || !isValidVariantId(variant)) {
		return "bg-zinc-500/20 text-zinc-600";
	}
	const config = VARIANT_CONFIG[variant];
	return `${config.bgClass} ${config.textClass}`;
}

/**
 * Get hex color for a variant (for charts, legends, etc.)
 */
export function getVariantColor(variant: VariantId | string | undefined): string {
	if (!variant || !isValidVariantId(variant)) {
		return "#71717a"; // zinc-500 fallback
	}
	return VARIANT_CONFIG[variant].color;
}

/**
 * Get variant label for display
 */
export function getVariantLabel(variant: VariantId | string | undefined): string {
	if (!variant || !isValidVariantId(variant)) {
		return variant ?? "Unknown";
	}
	return VARIANT_CONFIG[variant].label;
}

// ==================== Aggregate Index Config ====================

/**
 * Configuration for the aggregate "all" option in filters
 */
export const AGGREGATE_CONFIG = {
	id: "all" as const,
	label: "Aggregate Index",
	color: "#0f172a", // slate-900
	lightBg: "#f8fafc",
};

/**
 * Combined tabs for variant selectors (includes aggregate option)
 */
export const VARIANT_TABS: Array<{
	id: VariantIdWithAll;
	label: string;
	color: string;
	background: string;
}> = [
	{ id: AGGREGATE_CONFIG.id, label: AGGREGATE_CONFIG.label, color: AGGREGATE_CONFIG.color, background: AGGREGATE_CONFIG.lightBg },
	...VARIANT_IDS.map((id) => ({
		id,
		label: VARIANT_CONFIG[id].label,
		color: VARIANT_CONFIG[id].color,
		background: VARIANT_CONFIG[id].lightBg,
	})),
];

// ==================== Default Variant ====================

/**
 * Default variant for backward compatibility
 */
export const DEFAULT_VARIANT: VariantId = "Guardian";
