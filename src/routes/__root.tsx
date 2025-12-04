import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import Providers from "@/components/providers";

import TanStackQueryDevtools from "@/server/integrations/tanstack-query/devtools";
import appCss from "@/styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const SITE_URL = "https://goon.fast";
const SITE_NAME = "Autonome";
const SITE_DESCRIPTION =
	"AI-powered autonomous cryptocurrency trading platform with real-time portfolio analytics, multi-model AI strategies, and sophisticated trading simulation for both live and sandbox execution.";
const OG_IMAGE = `${SITE_URL}/logo.png`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			// Basic
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: `${SITE_NAME}` },
			{ name: "description", content: SITE_DESCRIPTION },

			// Keywords
			{
				name: "keywords",
				content: [
					"Autonome",
					"AI Trading",
					"Cryptocurrency Trading",
					"Autonomous Trading",
					"Trading Bot",
					"AI Trading Bot",
					"Crypto Portfolio",
					"Real-time Trading",
					"Trading Simulator",
					"Multi-model AI",
					"Portfolio Analytics",
					"Decentralized Trading",
					"Web3 Trading",
					"Algorithmic Trading",
					"Trading Platform",
					"Crypto AI",
					"Machine Learning Trading",
					"Trading Automation",
				].join(", "),
			},

			// Author & Creator
			{ name: "author", content: "Autonome Team" },
			{ name: "creator", content: "Autonome" },
			{ name: "publisher", content: "Autonome" },
			{ name: "generator", content: "TanStack Start" },

			// Robots
			{ name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
			{ name: "googlebot", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },

			// Open Graph
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: SITE_URL },
			{ property: "og:title", content: `${SITE_NAME}` },
			{ property: "og:description", content: SITE_DESCRIPTION },
			{ property: "og:image", content: OG_IMAGE },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:alt", content: "Autonome - AI Trading Platform" },
			{ property: "og:site_name", content: SITE_NAME },
			{ property: "og:locale", content: "en_US" },

			// Twitter Card
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:url", content: SITE_URL },
			{ name: "twitter:title", content: `${SITE_NAME}` },
			{ name: "twitter:description", content: SITE_DESCRIPTION },
			{ name: "twitter:image", content: OG_IMAGE },
			{ name: "twitter:image:alt", content: "Autonome - AI Trading Platform" },

			// Theme & App
			{ name: "theme-color", content: "#000000" },
			{ name: "color-scheme", content: "dark light" },
			{ name: "application-name", content: SITE_NAME },
			{ name: "apple-mobile-web-app-title", content: SITE_NAME },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
			{ name: "mobile-web-app-capable", content: "yes" },

			// Microsoft
			{ name: "msapplication-TileColor", content: "#000000" },
			{ name: "msapplication-TileImage", content: "/logo.png" },

			// Format Detection
			{ name: "format-detection", content: "telephone=no, date=no, email=no, address=no" },

			// Referrer
			{ name: "referrer", content: "origin-when-cross-origin" },

			// Category
			{ name: "category", content: "Finance, Technology, Cryptocurrency" },
		],
		links: [
			// Stylesheet
			{ rel: "stylesheet", href: appCss },

			// Canonical
			{ rel: "canonical", href: SITE_URL },

			// Icons
			{ rel: "icon", href: "/favicon.ico", sizes: "any" },
			{ rel: "icon", href: "/logo.png", type: "image/png", sizes: "512x512" },
			{ rel: "apple-touch-icon", href: "/logo.png", sizes: "180x180" },

			// Manifest
			{ rel: "manifest", href: "/manifest.json" },

			// Preconnect for performance
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{ rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },

			// DNS Prefetch
			{ rel: "dns-prefetch", href: "https://fonts.googleapis.com" },
		],
		scripts: [
			// Structured Data (JSON-LD)
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@graph": [
						{
							"@type": "WebSite",
							"@id": `${SITE_URL}/#website`,
							url: SITE_URL,
							name: SITE_NAME,
							description: SITE_DESCRIPTION,
							publisher: { "@id": `${SITE_URL}/#organization` },
							inLanguage: "en-US",
							potentialAction: {
								"@type": "SearchAction",
								target: {
									"@type": "EntryPoint",
									urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
								},
								"query-input": "required name=search_term_string",
							},
						},
						{
							"@type": "Organization",
							"@id": `${SITE_URL}/#organization`,
							name: SITE_NAME,
							url: SITE_URL,
							logo: {
								"@type": "ImageObject",
								url: OG_IMAGE,
								width: 512,
								height: 512,
							},
							sameAs: [],
						},
						{
							"@type": "WebApplication",
							"@id": `${SITE_URL}/#webapp`,
							name: SITE_NAME,
							description: SITE_DESCRIPTION,
							url: SITE_URL,
							applicationCategory: "FinanceApplication",
							operatingSystem: "Web",
							offers: {
								"@type": "Offer",
								price: "0",
								priceCurrency: "USD",
							},
							featureList: [
								"AI-powered trading decisions",
								"Real-time portfolio analytics",
								"Multi-model AI strategies",
								"Trading simulation",
								"Live market execution",
							],
						},
						{
							"@type": "SoftwareApplication",
							name: SITE_NAME,
							applicationCategory: "FinanceApplication",
							operatingSystem: "Web Browser",
							description: SITE_DESCRIPTION,
							offers: {
								"@type": "Offer",
								price: "0",
								priceCurrency: "USD",
							},
						},
					],
				}),
			},
		],
	}),

	beforeLoad: async () => {
		// Bootstrap schedulers on server-side only (runs once due to internal guard)
		if (typeof window === "undefined") {
			const { bootstrapSchedulers } = await import(
				"@/server/schedulers/bootstrap"
			);
			await bootstrapSchedulers();
		}
	},

	shellComponent: RootDocument,
	notFoundComponent: () => {
		return <div>404 - Page Not Found</div>;
	}
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" dir="ltr">
			<head>
				<HeadContent />
			</head>
			<body className="antialiased">
				<Providers>
					{children}
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							TanStackQueryDevtools,
						]}
					/>
					<Scripts />
				</Providers>
			</body>
		</html>
	);
}
