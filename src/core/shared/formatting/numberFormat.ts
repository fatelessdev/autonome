import {
	SUPPORTED_MARKETS,
	toCanonical,
} from "@/core/shared/markets/marketMetadata";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const DEFAULT_SYMBOLS = SUPPORTED_MARKETS;

export const normalizeNumber = (value: unknown): number | null => {
	if (value == null) return null;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string" && value.length > 0) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

export const formatCurrency = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	return currencyFormatter.format(numeric ?? 0);
};

export const formatCurrencyValue = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) return "N/A";
	return formatCurrency(numeric);
};

export const formatSignedCurrencyValue = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) return "--";
	const formatted = formatCurrency(Math.abs(numeric));
	return numeric > 0 ? `+${formatted}` : formatted;
};

export const formatQuantityValue = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) return "--";
	if (Math.abs(numeric) >= 1) return numeric.toFixed(2);
	return numeric.toPrecision(3);
};

export const formatConfidenceValue = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) return "----";
	const percentage = numeric <= 1 ? numeric * 100 : numeric;
	if (!Number.isFinite(percentage) || percentage < 0) return "----";
	if (percentage >= 99.5) return "100%";
	if (percentage >= 10) return `${percentage.toFixed(0)}%`;
	return `${percentage.toFixed(1)}%`;
};

export const formatPercentValue = (
	value: unknown,
	options?: {
		decimals?: number;
		includeSign?: boolean;
		fallback?: string;
	},
): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) {
		return options?.fallback ?? "N/A";
	}

	const decimals = options?.decimals ?? 2;
	const includeSign = options?.includeSign ?? false;
	const sign = includeSign && numeric >= 0 ? "+" : "";
	return `${sign}${numeric.toFixed(decimals)}%`;
};

export const formatPriceLabel = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) return "—";
	return formatCurrency(numeric);
};

export const parseSymbols = (raw: string | null): string[] => {
	if (!raw) {
		return [...DEFAULT_SYMBOLS];
	}

	const deduped = new Set<string>();
	raw
		.split(",")
		.map((symbol) => symbol.trim().toUpperCase())
		.filter(Boolean)
		.forEach((symbol) => {
			deduped.add(toCanonical(symbol));
		});

	return deduped.size > 0 ? Array.from(deduped) : [...DEFAULT_SYMBOLS];
};
