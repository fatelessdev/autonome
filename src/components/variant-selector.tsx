import { ChevronDown } from "lucide-react";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/core/lib/utils";
import { useVariant, VARIANT_TABS, type VariantId } from "./variant-context";

const TEXT_COLOR_FALLBACK = "#0f172a";

type BaseProps = {
	value?: VariantId;
	onChange?: (variant: VariantId) => void;
	className?: string;
};

type VariantSelectorProps = BaseProps & {
	layout?: "desktop" | "mobile";
};

const resolveHandlers = (
	value: VariantId | undefined,
	onChange: ((variant: VariantId) => void) | undefined,
) => {
	const { selectedVariant, setSelectedVariant } = useVariant();
	return {
		value: value ?? selectedVariant,
		onChange: onChange ?? setSelectedVariant,
	};
};

export function VariantSelector({ layout = "desktop", value, onChange, className }: VariantSelectorProps) {
	const handlers = resolveHandlers(value, onChange);

	if (layout === "mobile") {
		return <VariantSelectorMobile {...handlers} className={className} />;
	}

	return <VariantSelectorDesktop {...handlers} className={className} />;
}

export function VariantSelectorDesktop({
	value,
	onChange,
	className,
}: BaseProps) {
	const current = value ?? "all";
	const tab = VARIANT_TABS.find((item) => item.id === current) ?? VARIANT_TABS[0];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex items-center gap-2 px-3 py-2 text-sm font-semibold cursor-pointer",
						"rounded-sm border transition-all shadow-sm",
						"hover:-translate-y-[1px]",
						className,
					)}
					style={{
						backgroundColor: tab.background,
						color: tab.color || TEXT_COLOR_FALLBACK,
						borderColor: tab.color,
					}}
				>
					<span className="whitespace-nowrap leading-none">{tab.label}</span>
					<ChevronDown className="h-4 w-4 opacity-70" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[200px] p-0 overflow-hidden">
				{VARIANT_TABS.map((item) => {
					const isActive = item.id === current;
					return (
						<DropdownMenuItem
							key={item.id}
							onClick={() => onChange?.(item.id)}
							className={cn(
								"flex items-center gap-2 font-medium cursor-pointer rounded-none px-3 py-2",
								"transition-all duration-150",
								"hover:brightness-110 hover:scale-[1.02]",
								isActive && "ring-2 ring-inset ring-white/40",
							)}
							style={{
								backgroundColor: item.background,
								color: item.color || TEXT_COLOR_FALLBACK,
							}}
						>
							<span>{item.label}</span>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function VariantSelectorMobile({
	value,
	onChange,
	className,
}: BaseProps) {
	const current = value ?? "all";

	return (
		<div
			className={cn(
				"flex flex-nowrap items-center gap-1 overflow-x-auto scrollbar-hide",
				className,
			)}
			style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
		>
			{VARIANT_TABS.map((tab) => {
				const isActive = tab.id === current;
				return (
					<button
						key={tab.id}
						type="button"
						onClick={() => onChange?.(tab.id)}
						aria-pressed={isActive}
						aria-current={isActive ? "true" : undefined}
						className={cn(
							"px-3 py-2 text-[11px] font-semibold uppercase tracking-tight",
							"rounded-[4px] border transition-all shadow-sm flex-shrink-0",
							isActive
								? "shadow-md scale-[1.02]"
								: "opacity-80 hover:opacity-100",
						)}
						style={{
							backgroundColor: tab.background,
							color: tab.color || TEXT_COLOR_FALLBACK,
							borderColor: isActive ? tab.color : "transparent",
							boxShadow: isActive ? `0 0 0 1px ${tab.color}` : undefined,
						}}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}
