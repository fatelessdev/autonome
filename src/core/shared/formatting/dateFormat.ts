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
