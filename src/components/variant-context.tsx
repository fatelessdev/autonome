import { createContext, useContext, useState, type ReactNode } from "react";

import {
	type VariantId as SharedVariantId,
	type VariantIdWithAll,
	VARIANT_TABS,
} from "@/core/shared/variants";

// Re-export types and VARIANT_TABS for backward compatibility
export type VariantId = VariantIdWithAll;
export { VARIANT_TABS };

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
