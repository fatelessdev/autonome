export const normalizeIdentifier = (
	value: string | null | undefined,
	fallback = "",
): string => {
	if (typeof value !== "string") {
		return fallback;
	}

	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || fallback;
};
