import { motion } from "motion/react";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
import { cn } from "@/core/lib/utils";

const TRANSITION_STYLE_ID = "theme-toggle-circle-top-right";
const CIRCLE_TOP_RIGHT_BLUR_CSS = `
  ::view-transition-group(root) {
    animation-duration: 0.85s;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  ::view-transition-new(root) {
    animation-name: reveal-light-top-right;
    filter: blur(2px);
  }

  .dark::view-transition-new(root) {
    animation-name: reveal-dark-top-right;
    filter: blur(2px);
  }

  ::view-transition-old(root),
  .dark::view-transition-old(root) {
    animation: none;
    z-index: -1;
  }

  @keyframes reveal-light-top-right {
    from {
      clip-path: circle(0% at 100% 0%);
      filter: blur(10px);
    }
    60% {
      filter: blur(4px);
    }
    to {
      clip-path: circle(160% at 100% 0%);
      filter: blur(0px);
    }
  }

  @keyframes reveal-dark-top-right {
    from {
      clip-path: circle(0% at 100% 0%);
      filter: blur(10px);
    }
    60% {
      filter: blur(4px);
    }
    to {
      clip-path: circle(160% at 100% 0%);
      filter: blur(0px);
    }
  }
`;

const ensureTransitionStyles = () => {
	if (typeof document === "undefined") return;
	let styleEl = document.getElementById(
		TRANSITION_STYLE_ID,
	) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.createElement("style");
		styleEl.id = TRANSITION_STYLE_ID;
		document.head.appendChild(styleEl);
	}
	if (styleEl.textContent !== CIRCLE_TOP_RIGHT_BLUR_CSS) {
		styleEl.textContent = CIRCLE_TOP_RIGHT_BLUR_CSS;
	}
};

const runThemeTransition = (
	nextTheme: "light" | "dark",
	setTheme: (theme: string) => void,
) => {
	if (typeof document === "undefined") {
		setTheme(nextTheme);
		return;
	}

	ensureTransitionStyles();

	const doc = document as Document & {
		startViewTransition?: (callback: () => void) => void;
	};

	const switchTheme = () => setTheme(nextTheme);

	if (typeof doc.startViewTransition === "function") {
		doc.startViewTransition(switchTheme);
	} else {
		switchTheme();
	}
};

type ThemeToggleButton2Props = {
	className?: string;
};

export function ThemeToggleButton2({ className }: ThemeToggleButton2Props) {
	const clipPathId = useId();
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted || !resolvedTheme) return;
		setIsDark(resolvedTheme === "dark");
	}, [mounted, resolvedTheme]);

	const handleToggle = () => {
		if (!mounted) return;
		const nextIsDark = !isDark;
		setIsDark(nextIsDark);
		runThemeTransition(nextIsDark ? "dark" : "light", setTheme);
	};

	return (
		<button
			type="button"
			onClick={handleToggle}
			aria-label="Toggle theme"
			className={cn(
				"group relative inline-flex items-center justify-center rounded-full transition-all duration-300",
				className,
			)}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true"
				fill="currentColor"
				strokeLinecap="round"
				viewBox="0 0 32 32"
				className="h-7 w-7 transition-colors duration-300"
			>
				<clipPath id={clipPathId}>
					<motion.path
						animate={{ y: isDark ? 10 : 0, x: isDark ? -12 : 0 }}
						transition={{ ease: "easeInOut", duration: 0.35 }}
						d="M0-5h30a1 1 0 0 0 9 13v24H0Z"
					/>
				</clipPath>
				<g clipPath={`url(#${clipPathId})`}>
					<motion.circle
						animate={{ r: isDark ? 10 : 8 }}
						transition={{ ease: "easeInOut", duration: 0.35 }}
						cx="16"
						cy="16"
					/>
					<motion.g
						animate={{
							rotate: isDark ? -100 : 0,
							scale: isDark ? 0.5 : 1,
							opacity: isDark ? 0 : 1,
						}}
						transition={{ ease: "easeInOut", duration: 0.35 }}
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<path d="M16 5.5v-4" />
						<path d="M16 30.5v-4" />
						<path d="M1.5 16h4" />
						<path d="M26.5 16h4" />
						<path d="m23.4 8.6 2.8-2.8" />
						<path d="m5.7 26.3 2.9-2.9" />
						<path d="m5.8 5.8 2.8 2.8" />
						<path d="m23.4 23.4 2.9 2.9" />
					</motion.g>
				</g>
			</svg>
			<span className="absolute inset-0 -z-10 rounded-full bg-white/40 blur-3xl transition-opacity duration-300 group-hover:opacity-90 dark:bg-cyan-500/20" />
		</button>
	);
}
