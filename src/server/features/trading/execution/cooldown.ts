export const DEFAULT_COOLDOWN_MINUTES = 15;
export const MIN_COOLDOWN_MINUTES = 1;
export const MAX_COOLDOWN_MINUTES = 15;

export function clampCooldownMinutes(minutes?: number | null): number {
	return Math.min(
		MAX_COOLDOWN_MINUTES,
		Math.max(MIN_COOLDOWN_MINUTES, minutes ?? DEFAULT_COOLDOWN_MINUTES),
	);
}

export function calculateCooldownUntil(minutes?: number | null): string {
	const cooldownMinutes = clampCooldownMinutes(minutes);
	return new Date(Date.now() + cooldownMinutes * 60 * 1000).toISOString();
}
