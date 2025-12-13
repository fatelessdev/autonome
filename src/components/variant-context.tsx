import { createContext, useContext, useState, type ReactNode } from "react";

export type VariantId = "all" | "Situational" | "Minimal" | "Guardian" | "Max";

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
		color: "#1f9d55",
		background: "#e4f3da",
	},
	{
		id: "Minimal",
		label: "Minimal Discipline",
		color: "#c0843d",
		background: "#f6eddc",
	},
	{
		id: "Guardian",
		label: "Guardian (Survival)",
		color: "#c14c86",
		background: "#f9e0ec",
	},
	{
		id: "Max",
		label: "Max Leverage",
		color: "#3a82b9",
		background: "#e3f1fb",
	},
];
