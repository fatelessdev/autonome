import { createContext, useContext, useState, type ReactNode } from "react";

export type VariantId = "all" | "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian";

export interface VariantContextValue {
	selectedVariant: VariantId;
	setSelectedVariant: (variant: VariantId) => void;
}

const VariantContext = createContext<VariantContextValue | null>(null);

export function VariantProvider({ children }: { children: ReactNode }) {
	const [selectedVariant, setSelectedVariant] = useState<VariantId>("all");

	return (
		<VariantContext.Provider value={{ selectedVariant, setSelectedVariant }}>
			{children}
		</VariantContext.Provider>
	);
}

export function useVariant() {
	const context = useContext(VariantContext);
	if (!context) {
		throw new Error("useVariant must be used within a VariantProvider");
	}
	return context;
}

export const VARIANT_TABS: {
	id: VariantId;
	label: string;
	color: string;
	background: string;
}[] = [
	{ id: "all", label: "Aggregate Index", color: "#0f172a", background: "#f8fafc" },
	{
		id: "Guardian",
		label: "Guardian (Fortress)",
		color: "#a855f7",
		background: "#faf5ff",
	},
	{
		id: "Apex",
		label: "Apex (Kelly Engine)",
		color: "#f59e0b",
		background: "#fffbeb",
	},
	{
		id: "Gladiator",
		label: "Gladiator (Tournament)",
		color: "#22c55e",
		background: "#f0fdf4",
	},
	{
		id: "Sniper",
		label: "Sniper (Precision)",
		color: "#3b82f6",
		background: "#eff6ff",
	},
	{
		id: "Trendsurfer",
		label: "Trendsurfer (Momentum)",
		color: "#06b6d4",
		background: "#ecfeff",
	},
	{
		id: "Contrarian",
		label: "Contrarian (Reverter)",
		color: "#e11d48",
		background: "#fff1f2",
	},
];
