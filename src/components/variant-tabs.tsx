import { cn } from "@/core/lib/utils";
import { useVariant, VARIANT_TABS, type VariantId } from "./variant-context";

export function VariantTabs() {
	const { selectedVariant, setSelectedVariant } = useVariant();

	return (
		<div className="flex items-center gap-1 border-b border-border/50 px-4 py-1 bg-muted/30 overflow-x-auto">
			{VARIANT_TABS.map((tab) => (
				<button
					key={tab.id}
					type="button"
					onClick={() => setSelectedVariant(tab.id)}
					className={cn(
						"px-4 py-2 text-sm font-medium whitespace-nowrap transition-all",
						"hover:text-foreground",
						selectedVariant === tab.id
							? "text-foreground border-b-2"
							: "text-muted-foreground border-b-2 border-transparent",
					)}
					style={{
						borderColor: selectedVariant === tab.id ? tab.color : undefined,
					}}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}
