import { AnimatePresence, motion } from "motion/react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/core/lib/utils";

export type InputShadowPreset = "inset" | "layered" | "neon" | "neumorphic";

const SHADOW_PRESETS: Record<InputShadowPreset, string> = {
	inset:
		"shadow-[inset_14px_24px_16px_-21px_rgba(209,217,230,0.34),inset_14px_28px_20px_-21px_rgba(209,217,230,0.4),inset_14px_35px_27px_-21px_rgba(209,217,230,0.48),inset_14px_54px_43px_-21px_rgba(209,217,230,0.67),inset_-36px_-63px_47px_-21px_rgba(255,255,255,0.75),inset_-36px_-36.8341px_24.6719px_-21px_rgba(255,255,255,0.54),inset_-36px_-31.3638px_17.026000000000003px_-21px_rgba(255,255,255,0.45),inset_-36px_-28.4185px_16px_-21px_rgba(255,255,255,0.38)]",
	layered:
		"shadow-[0_30px_40px_rgba(0,0,0,0.1),0_0_20px_rgba(0,0,0,0.1),0_-10px_10px_rgba(255,255,255,0.2)]",
	neon: "shadow-[0_0_20px_rgba(0,255,255,0.7),0_0_40px_rgba(0,0,255,0.5),0_0_60px_rgba(0,0,128,0.3)]",
	neumorphic: "shadow-[20px_20px_60px_#d9d9d9,-20px_-20px_60px_#ffffff]",
};

type PlaceholdersAndVanishInputProps = {
	placeholders: string[];
	onSubmit: (value: string) => void;
	onValueChange?: (value: string) => void;
	disabled?: boolean;
	shadowPreset?: InputShadowPreset;
	className?: string;
};

export function PlaceholdersAndVanishInput({
	placeholders,
	onSubmit,
	onValueChange,
	disabled = false,
	shadowPreset = "inset",
	className,
}: PlaceholdersAndVanishInputProps) {
	const resolvedPlaceholders =
		placeholders.length > 0
			? placeholders
			: ["Ask anything about your trading data..."];
	const [placeholderIndex, setPlaceholderIndex] = useState(0);
	const [value, setValue] = useState("");
	const [animating, setAnimating] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const particlesRef = useRef<
		Array<{ x: number; y: number; r: number; color: string }>
	>([]);
	const inputRef = useRef<HTMLInputElement>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	const rotationDelay = useMemo(
		() => (resolvedPlaceholders.length > 1 ? 3000 : null),
		[resolvedPlaceholders.length],
	);

	const startRotation = useCallback(() => {
		if (!rotationDelay || intervalRef.current) return;
		intervalRef.current = setInterval(() => {
			setPlaceholderIndex((prev) => (prev + 1) % resolvedPlaceholders.length);
		}, rotationDelay);
	}, [resolvedPlaceholders.length, rotationDelay]);

	const stopRotation = useCallback(() => {
		if (!intervalRef.current) return;
		clearInterval(intervalRef.current);
		intervalRef.current = null;
	}, []);

	useEffect(() => {
		startRotation();
		return () => {
			stopRotation();
		};
	}, [startRotation, stopRotation]);

	useEffect(() => {
		if (!rotationDelay) return;
		const handleVisibility = () => {
			if (document.visibilityState === "visible") {
				startRotation();
			} else {
				stopRotation();
			}
		};

		document.addEventListener("visibilitychange", handleVisibility);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	}, [rotationDelay, startRotation, stopRotation]);

	const drawParticles = useCallback(() => {
		if (!inputRef.current) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d");
		if (!context) return;

		canvas.width = 800;
		canvas.height = 800;
		context.clearRect(0, 0, canvas.width, canvas.height);

		const styles = getComputedStyle(inputRef.current);
		const fontSize = Number.parseFloat(styles.getPropertyValue("font-size"));
		context.font = `${fontSize * 2}px ${styles.fontFamily}`;
		context.fillStyle = "#ffffff";
		context.fillText(value, 16, 40);

		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		const nextParticles: Array<{
			x: number;
			y: number;
			r: number;
			color: string;
		}> = [];

		for (let row = 0; row < canvas.height; row += 1) {
			for (let column = 0; column < canvas.width; column += 1) {
				const offset = (row * canvas.width + column) * 4;
				const red = data[offset];
				const green = data[offset + 1];
				const blue = data[offset + 2];
				const alpha = data[offset + 3];

				if (red === 0 && green === 0 && blue === 0 && alpha === 0) continue;
				nextParticles.push({
					x: column,
					y: row,
					r: 1,
					color: `rgba(${red}, ${green}, ${blue}, ${alpha})`,
				});
			}
		}

		particlesRef.current = nextParticles;
	}, [value]);

	useEffect(() => {
		if (!value) return;
		drawParticles();
	}, [value, drawParticles]);

	const animateParticles = useCallback(
		(start: number) => {
			const step = (position: number) => {
				const nextParticles: typeof particlesRef.current = [];
				for (const particle of particlesRef.current) {
					if (particle.x < position) {
						nextParticles.push(particle);
						continue;
					}

					if (particle.r <= 0) {
						continue;
					}

					const directionX = Math.random() > 0.5 ? 1 : -1;
					const directionY = Math.random() > 0.5 ? 1 : -1;
					nextParticles.push({
						...particle,
						x: particle.x + directionX,
						y: particle.y + directionY,
						r: particle.r - 0.05 * Math.random(),
					});
				}

				particlesRef.current = nextParticles;
				const context = canvasRef.current?.getContext("2d");
				if (context) {
					context.clearRect(position, 0, 800, 800);
					for (const particle of particlesRef.current) {
						if (particle.x <= position) continue;
						context.beginPath();
						context.rect(particle.x, particle.y, particle.r, particle.r);
						context.fillStyle = particle.color;
						context.strokeStyle = particle.color;
						context.stroke();
					}
				}

				if (particlesRef.current.length > 0) {
					requestAnimationFrame(() => step(position - 8));
				} else {
					setValue("");
					onValueChange?.("");
					setAnimating(false);
				}
			};

			requestAnimationFrame(() => step(start));
		},
		[onValueChange],
	);

	const vanishAndSubmit = useCallback(() => {
		if (!inputRef.current) return;
		drawParticles();
		if (particlesRef.current.length === 0) {
			setValue("");
			onValueChange?.("");
			setAnimating(false);
			return;
		}

		const furthest = particlesRef.current.reduce(
			(max, particle) => (particle.x > max ? particle.x : max),
			0,
		);
		animateParticles(furthest);
	}, [animateParticles, drawParticles, onValueChange]);

	const handleSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (disabled || animating) return;
			const trimmed = value.trim();
			if (!trimmed) return;
			setAnimating(true);
			onSubmit(trimmed);
			vanishAndSubmit();
		},
		[animating, disabled, onSubmit, value, vanishAndSubmit],
	);

	const handleChange = useCallback(
		(next: string) => {
			if (disabled || animating) return;
			setValue(next);
			onValueChange?.(next);
		},
		[animating, disabled, onValueChange],
	);

	return (
		<form
			onSubmit={handleSubmit}
			className={cn(
				"relative flex h-12 w-full max-w-3xl items-center justify-center overflow-hidden rounded-full bg-white transition duration-200 ease-out dark:bg-zinc-800",
				value && "bg-slate-50 dark:bg-zinc-900/70",
				SHADOW_PRESETS[shadowPreset],
				className,
			)}
		>
			<canvas
				ref={canvasRef}
				className={cn(
					"pointer-events-none absolute left-2 top-[22%] origin-top-left scale-50 transform pr-20 text-base filter invert transition-opacity dark:invert-0",
					animating ? "opacity-100" : "opacity-0",
				)}
			/>

			<input
				ref={inputRef}
				value={value}
				disabled={disabled}
				onChange={(event) => handleChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						inputRef.current?.form?.requestSubmit();
					}
				}}
				type="text"
				className={cn(
					"relative z-10 h-full w-full rounded-full border-none bg-transparent pl-4 pr-20 text-sm text-black outline-none transition placeholder:text-transparent focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-70 sm:pl-10 sm:text-base dark:text-white",
					animating && "text-transparent",
				)}
				placeholder={resolvedPlaceholders[placeholderIndex]}
			/>

			<button
				type="submit"
				disabled={disabled || animating || value.trim().length === 0}
				className="absolute right-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black text-white transition hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-neutral-300 dark:bg-zinc-900 dark:text-zinc-100"
				aria-label="Send prompt"
			>
				<motion.svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="h-4 w-4"
				>
					<path stroke="none" d="M0 0h24v24H0z" />
					<motion.path
						d="M5 12h14"
						initial={{ strokeDasharray: "50%", strokeDashoffset: "50%" }}
						animate={{ strokeDashoffset: value ? 0 : "50%" }}
						transition={{ duration: 0.3, ease: "linear" }}
					/>
					<path d="M13 18l6-6" />
					<path d="M13 6l6 6" />
				</motion.svg>
			</button>

			<div className="pointer-events-none absolute inset-0 flex items-center rounded-full">
				<AnimatePresence mode="wait">
					{!value && (
						<motion.p
							key={`placeholder-${placeholderIndex}`}
							initial={{ y: 6, opacity: 0 }}
							animate={{ y: 0, opacity: 1 }}
							exit={{ y: -12, opacity: 0 }}
							transition={{ duration: 0.3, ease: "linear" }}
							className="w-[calc(100%-2rem)] truncate pl-4 text-sm font-normal text-neutral-500 sm:pl-12 sm:text-base dark:text-zinc-500"
						>
							{resolvedPlaceholders[placeholderIndex]}
						</motion.p>
					)}
				</AnimatePresence>
			</div>
		</form>
	);
}
