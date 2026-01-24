import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import * as TanstackQuery from "@/server/integrations/tanstack-query/root-provider";
import { Analytics } from "@vercel/analytics/next"

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance - must be a named function export for TanStack Start
export function getRouter() {
	const rqContext = TanstackQuery.getContext();

	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		context: { ...rqContext },
		defaultPreload: "render",
		Wrap: (props: { children: React.ReactNode }) => {
			return (
				<TanstackQuery.Provider {...rqContext}>
					{props.children}
					<Analytics />
				</TanstackQuery.Provider>
			);
		},
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient: rqContext.queryClient,
	});

	if (!router.isServer) {
		Sentry.init({
			dsn: import.meta.env.VITE_SENTRY_DSN,
			integrations: [],
		});
	}

	return router;
}
