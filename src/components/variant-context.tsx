import { createContext, useContext, useState, type ReactNode } from "react";

export type VariantId = "all" | "Situational" | "Minimal" | "Guardian" | "Max" | "Sovereign";

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
		id: "Situational",
		label: "Situational Awareness",
		color: "#22c55e",
		background: "#f0fdf4",
	},
	{
		id: "Minimal",
		label: "Minimal Discipline",
		color: "#3b82f6",
		background: "#eff6ff",
	},
	{
		id: "Guardian",
		label: "Guardian (Survival)",
		color: "#a855f7",
		background: "#faf5ff",
	},
	{
		id: "Max",
		label: "Max Leverage",
		color: "#f59e0b",
		background: "#fffbeb",
	},
	{
		id: "Sovereign",
		label: "Sovereign (Elite)",
		color: "#e11d48",
		background: "#fff1f2",
	},
];
