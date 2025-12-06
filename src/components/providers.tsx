import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";
import { VariantProvider } from "./variant-context";

export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<VariantProvider>
				{children}
			</VariantProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}
