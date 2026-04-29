import { createContext, type ReactNode, useContext, useState } from "react";

import { VARIANT_TABS, type VariantIdWithAll } from "@/core/shared/variants";

// Re-export VariantIdWithAll and VARIANT_TABS for consumer convenience
export type { VariantIdWithAll };
export { VARIANT_TABS };

export interface VariantContextValue {
	selectedVariant: VariantIdWithAll;
	setSelectedVariant: (variant: VariantIdWithAll) => void;
}

const VariantContext = createContext<VariantContextValue | null>(null);

export function VariantProvider({ children }: { children: ReactNode }) {
	const [selectedVariant, setSelectedVariant] = useState<VariantIdWithAll>("all");

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
