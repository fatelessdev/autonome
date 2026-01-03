/**
 * TAAPI Cache
 * In-memory LRU cache with TTL for TAAPI responses
 * Shared across all models/variants running at the same time
 */

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

class TaapiCache {
	private cache = new Map<string, CacheEntry<unknown>>();
	private ttlMs: number;
	private maxSize: number;

	constructor(ttlSeconds = 60, maxSize = 100) {
		this.ttlMs = ttlSeconds * 1000;
		this.maxSize = maxSize;
	}

	private makeKey(
		asset: string,
		timeframe: string,
		indicatorSet?: string,
	): string {
		return indicatorSet
			? `${asset}:${timeframe}:${indicatorSet}`
			: `${asset}:${timeframe}`;
	}

	/**
	 * Get cached value if it exists and hasn't expired
	 */
	get<T>(asset: string, timeframe: string, indicatorSet?: string): T | null {
		const key = this.makeKey(asset, timeframe, indicatorSet);
		const entry = this.cache.get(key);

		if (!entry) return null;

		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		return entry.value as T;
	}

	/**
	 * Set a value in the cache with TTL
	 */
	set<T>(
		asset: string,
		timeframe: string,
		value: T,
		indicatorSet?: string,
	): void {
		const key = this.makeKey(asset, timeframe, indicatorSet);

		// Evict oldest entries if at max size
		if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(key, {
			value,
			expiresAt: Date.now() + this.ttlMs,
		});
	}

	/**
	 * Check if a key exists and is not expired
	 */
	has(asset: string, timeframe: string, indicatorSet?: string): boolean {
		return this.get(asset, timeframe, indicatorSet) !== null;
	}

	/**
	 * Clear all cached entries
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Remove expired entries (called periodically or on-demand)
	 */
	prune(): number {
		const now = Date.now();
		let pruned = 0;

		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
				pruned++;
			}
		}

		return pruned;
	}

	/**
	 * Get cache stats for debugging
	 */
	stats(): { size: number; maxSize: number; ttlSeconds: number } {
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			ttlSeconds: this.ttlMs / 1000,
		};
	}
}

// Singleton instance with 60s TTL and max 100 entries
export const taapiCache = new TaapiCache(60, 100);
