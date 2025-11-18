const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL"] as const;

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

export const formatLeverageValue = (value: unknown): string => {
	const numeric = normalizeNumber(value);
	if (numeric == null) return "--";
	const rounded = Math.round(numeric * 100) / 100;
	const isWhole = Math.abs(rounded - Math.round(rounded)) < 1e-6;
	if (isWhole) {
		return `${Math.round(rounded)}x`;
	}
	return `${rounded.toFixed(2)}x`;
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
		.forEach((symbol) => deduped.add(symbol));

	return deduped.size > 0 ? Array.from(deduped) : [...DEFAULT_SYMBOLS];
};
