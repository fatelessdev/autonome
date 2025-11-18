import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query inside React components without risking hydration mismatches.
 */

export function useMediaQuery(
	query: string,
	options?: { defaultValue?: boolean },
): boolean {
	const defaultValue = options?.defaultValue ?? true;

	const [matches, setMatches] = useState<boolean>(() => {
		if (typeof window === "undefined") {
			return defaultValue;
		}
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			return () => undefined;
		}

		const mediaQueryList = window.matchMedia(query);

		const updateMatches = (event: MediaQueryListEvent | MediaQueryList) => {
			setMatches(event.matches);
		};

		updateMatches(mediaQueryList);

		if (typeof mediaQueryList.addEventListener === "function") {
			mediaQueryList.addEventListener("change", updateMatches);
			return () => mediaQueryList.removeEventListener("change", updateMatches);
		}

		mediaQueryList.addListener(updateMatches);
		return () => mediaQueryList.removeListener(updateMatches);
	}, [query]);

	return matches;
}
