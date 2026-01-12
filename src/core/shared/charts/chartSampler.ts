/**
 * Chart Data Sampler
 *
 * Adaptive sampling utility that ensures charts render smoothly regardless of
 * data size while preserving visual accuracy. Uses time-based bucketing to
 * maintain uniform time distribution across the chart.
 *
 * Budget guidelines based on typical chart rendering performance:
 * - Desktop: 800 points (good detail, smooth 60fps rendering)
 * - Mobile: 400 points (lighter for smaller screens/lower power devices)
 */

// ==================== Constants ====================

/** Maximum data points for desktop charts */
export const DESKTOP_POINT_BUDGET = 800;

/** Maximum data points for mobile charts */
export const MOBILE_POINT_BUDGET = 400;

/** Threshold below which no sampling is applied */
export const MIN_SAMPLE_THRESHOLD = 100;

// ==================== Types ====================

export interface TimestampedPoint {
	timestamp?: number;
	[key: string]: unknown;
}

// ==================== Sampling Functions ====================

/**
 * Downsample an array using time-based bucketing.
 * Divides the time range into equal buckets and picks one point per bucket.
 * Always preserves the first and last points for accurate range display.
 *
 * @param data - Array of data points with `timestamp` field (must be sorted chronologically)
 * @param budget - Maximum number of points to return
 * @returns Sampled array with uniform time distribution
 */
export function timeBasedSample<T extends TimestampedPoint>(
	data: T[],
	budget: number,
): T[] {
	const n = data.length;

	// No sampling needed if under budget
	if (n <= budget || budget < 2) {
		return data;
	}

	// Find time range
	const firstPoint = data[0]!;
	const lastPoint = data[n - 1]!;
	const startTime = firstPoint.timestamp;
	const endTime = lastPoint.timestamp;

	// If no valid timestamps, fall back to uniform stride
	if (typeof startTime !== "number" || typeof endTime !== "number") {
		return uniformStrideSample(data, budget);
	}

	const timeRange = endTime - startTime;
	if (timeRange <= 0) {
		return uniformStrideSample(data, budget);
	}

	// Calculate bucket size (we need budget points, so budget-1 intervals)
	const bucketSize = timeRange / (budget - 1);

	const result: T[] = [];
	let dataIndex = 0;

	// For each target time bucket, find the closest point
	for (let i = 0; i < budget; i++) {
		const targetTime = startTime + i * bucketSize;

		// Find the point closest to targetTime (starting from current index)
		let bestIndex = dataIndex;
		let bestDiff = Math.abs((data[bestIndex]?.timestamp ?? 0) - targetTime);

		// Scan forward to find closer point
		while (dataIndex < n - 1) {
			const nextDiff = Math.abs((data[dataIndex + 1]?.timestamp ?? 0) - targetTime);
			if (nextDiff < bestDiff) {
				dataIndex++;
				bestIndex = dataIndex;
				bestDiff = nextDiff;
			} else {
				// Points are getting further, stop scanning
				break;
			}
		}

		// Add the best point for this bucket (avoid duplicates)
		const point = data[bestIndex]!;
		if (result.length === 0 || result[result.length - 1] !== point) {
			result.push(point);
		}
	}

	// Ensure we have the exact last point
	if (result[result.length - 1] !== lastPoint) {
		result.push(lastPoint);
	}

	return result;
}

/**
 * Downsample an array to a target budget using uniform stride sampling.
 * Always preserves the first and last elements to maintain visual continuity.
 * Use this as fallback when timestamps are not available.
 *
 * @param data - Array of data points (must be chronologically sorted)
 * @param budget - Maximum number of points to return
 * @returns Sampled array with at most `budget` points
 */
export function uniformStrideSample<T>(data: T[], budget: number): T[] {
	const n = data.length;

	// No sampling needed if under budget
	if (n <= budget || budget < 2) {
		return data;
	}

	const result: T[] = [];

	// Always include first point
	result.push(data[0]!);

	// Calculate stride for middle points
	// We need (budget - 2) points between first and last
	const middleCount = budget - 2;
	const stride = (n - 2) / middleCount;

	for (let i = 0; i < middleCount; i++) {
		// Use Math.round to get evenly distributed indices
		const index = Math.round(1 + i * stride);
		// Avoid duplicating first or last
		if (index > 0 && index < n - 1) {
			result.push(data[index]!);
		}
	}

	// Always include last point
	result.push(data[n - 1]!);

	return result;
}

/**
 * Get the appropriate point budget based on viewport width.
 * Uses sensible defaults that balance performance with visual detail.
 *
 * @param isCompact - Whether the viewport is mobile/compact
 * @returns Point budget for the current viewport
 */
export function getPointBudget(isCompact: boolean): number {
	return isCompact ? MOBILE_POINT_BUDGET : DESKTOP_POINT_BUDGET;
}

/**
 * Sample chart data with automatic budget detection.
 * Uses time-based bucketing for uniform time distribution.
 *
 * @param data - Array of data points with `timestamp` field (chronologically sorted)
 * @param isCompact - Whether viewport is mobile/compact
 * @returns Sampled array appropriate for the viewport
 */
export function sampleForViewport<T extends TimestampedPoint>(
	data: T[],
	isCompact: boolean,
): T[] {
	const budget = getPointBudget(isCompact);
	return timeBasedSample(data, budget);
}

/**
 * Sample multiple series of data with the same stride pattern.
 * Useful when you have parallel arrays that need consistent sampling.
 *
 * @param arrays - Object with named arrays to sample
 * @param budget - Maximum points per array
 * @returns Object with sampled arrays using same indices
 */
export function uniformStrideSampleMultiple<T extends Record<string, unknown[]>>(
	arrays: T,
	budget: number,
): T {
	const keys = Object.keys(arrays);
	if (keys.length === 0) return arrays;

	// Use the first array's length as reference
	const referenceKey = keys[0]!;
	const n = arrays[referenceKey]!.length;

	if (n <= budget || budget < 2) {
		return arrays;
	}

	// Calculate the indices we'll sample
	const indices: number[] = [0]; // First point
	const middleCount = budget - 2;
	const stride = (n - 2) / middleCount;

	for (let i = 0; i < middleCount; i++) {
		const index = Math.round(1 + i * stride);
		if (index > 0 && index < n - 1) {
			indices.push(index);
		}
	}
	indices.push(n - 1); // Last point

	// Apply the same indices to all arrays
	const result = {} as T;
	for (const key of keys) {
		const arr = arrays[key]!;
		result[key as keyof T] = indices.map((i) => arr[i]) as T[keyof T];
	}

	return result;
}
