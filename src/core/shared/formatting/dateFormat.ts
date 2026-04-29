const IST_TIMEZONE = "Asia/Kolkata";
type DateTimePartType = Intl.DateTimeFormatPart["type"];

const formatter = new Intl.DateTimeFormat("en-US", {
	timeZone: IST_TIMEZONE,
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hour12: true,
});

const partLookup = (
	parts: Intl.DateTimeFormatPart[],
	type: DateTimePartType,
) => {
	const match = parts.find((part) => part.type === type);
	return match?.value ?? "";
};

export function formatIstTimestamp(
	input: string | number | Date | null | undefined,
): string {
	if (input === null || input === undefined || input === "") {
		return "--";
	}

	const date = input instanceof Date ? input : new Date(input);
	if (Number.isNaN(date.getTime())) {
		return "--";
	}

	const parts = formatter.formatToParts(date);
	const month = partLookup(parts, "month");
	const day = partLookup(parts, "day");
	const hour = partLookup(parts, "hour");
	const minute = partLookup(parts, "minute");
	const dayPeriodRaw = partLookup(parts, "dayPeriod");
	const dayPeriod = dayPeriodRaw ? dayPeriodRaw.toUpperCase() : "";

	if (!month || !day || !hour || !minute) {
		return formatter.format(date);
	}

	const core = `${month}/${day}, ${hour}:${minute}`;
	return dayPeriod ? `${core} ${dayPeriod}` : `${core}`;
}

/**
 * Format a duration between two dates as a human-readable string (e.g. "2D 5H 30M").
 * Returns "<1M" when the duration is zero or negative.
 */
export function formatDuration(openedAt: Date, closedAt: Date): string {
	const diffMs = closedAt.getTime() - openedAt.getTime();
	if (diffMs <= 0) return "<1M";
	const totalMinutes = Math.floor(diffMs / 60000);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}D`);
	if (hours > 0) parts.push(`${hours}H`);
	parts.push(`${minutes}M`);
	return parts.join(" ");
}
