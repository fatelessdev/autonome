export const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const safeJsonParse = <T>(
	value: string | null | undefined,
	fallback: T,
): T => {
	if (!value) {
		return fallback;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		return (parsed ?? fallback) as T;
	} catch {
		return fallback;
	}
};

export const getArray = <T>(value: unknown): T[] => {
	return Array.isArray(value) ? (value as T[]) : [];
};
