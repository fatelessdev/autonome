/**
 * Error Deduplicator
 *
 * Normalizes error messages by stripping variable parts (numbers, UUIDs,
 * timestamps) and deduplicates within a sliding time window. Prevents
 * log spam from repeated identical errors with different numeric context.
 */

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5-minute sliding window

/** UUID v4 pattern */
const UUID_RE =
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** ISO 8601 timestamp pattern (e.g. 2026-04-30T21:53:00.000Z) */
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;

/** General numbers (integers and decimals, including negatives) */
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

/**
 * Normalizes an error message by stripping variable parts so that
 * structurally identical errors produce the same key.
 */
export function normalizeErrorMessage(message: string): string {
	return message
		.replace(UUID_RE, "<uuid>")
		.replace(ISO_TIMESTAMP_RE, "<timestamp>")
		.replace(NUMBER_RE, "<n>");
}

interface DedupEntry {
	/** Timestamp of the first occurrence in the current window */
	firstSeenAt: number;
	/** Timestamp of the last occurrence in the current window */
	lastSeenAt: number;
	/** Number of additional (suppressed) occurrences after the first */
	suppressedCount: number;
}

/**
 * Deduplicates error messages within a sliding time window.
 *
 * Usage:
 *   const dedup = new ErrorDeduplicator();
 *   const result = dedup.shouldLog(normalizeErrorMessage(rawMessage));
 *   if (result.shouldLog) {
 *     console.error(`... error ... (suppressed ${result.suppressedCount} duplicates)`);
 *   }
 */
export class ErrorDeduplicator {
	private windowMs: number;
	private entries = new Map<string, DedupEntry>();

	constructor(windowMs: number = DEDUP_WINDOW_MS) {
		this.windowMs = windowMs;
	}

	/**
	 * Check whether this error should be logged.
	 *
	 * - First occurrence: shouldLog=true, suppressedCount=0
	 * - Duplicate within window: shouldLog=false, suppressedCount=total duplicates so far
	 * - After window expires: shouldLog=true, suppressedCount=0 (fresh start)
	 */
	shouldLog(normalizedKey: string): {
		shouldLog: boolean;
		suppressedCount: number;
	} {
		const now = Date.now();
		const existing = this.entries.get(normalizedKey);

		if (!existing) {
			this.entries.set(normalizedKey, {
				firstSeenAt: now,
				lastSeenAt: now,
				suppressedCount: 0,
			});
			return { shouldLog: true, suppressedCount: 0 };
		}

		// Window expired — reset and log fresh
		if (now - existing.lastSeenAt > this.windowMs) {
			this.entries.set(normalizedKey, {
				firstSeenAt: now,
				lastSeenAt: now,
				suppressedCount: 0,
			});
			return { shouldLog: true, suppressedCount: 0 };
		}

		// Within window — suppress
		existing.lastSeenAt = now;
		existing.suppressedCount++;
		return { shouldLog: false, suppressedCount: existing.suppressedCount };
	}

	/** Clear all tracked entries (useful for testing) */
	clear(): void {
		this.entries.clear();
	}
}
