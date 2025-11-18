import { createFileRoute } from "@tanstack/react-router";

import CryptoTracker from "@/components/crypto-tracker";
import Header from "@/components/header";
import PerformanceGraph from "@/components/performance-graph";
import TradesSidebar from "@/components/trades-sidebar";
import { LightRays } from "@/components/ui/light-rays";
import { SUPPORTED_MARKETS } from "@/core/shared/markets/marketMetadata";
import {
	MARKET_QUERIES,
	PORTFOLIO_QUERIES,
} from "@/core/shared/markets/marketQueries";
import { DASHBOARD_QUERIES } from "@/core/shared/trading/dashboardQueries";
import { useBoolean } from "@/hooks/useBoolean";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const DASHBOARD_PREFETCHES = [
	DASHBOARD_QUERIES.trades(),
	DASHBOARD_QUERIES.positions(),
	DASHBOARD_QUERIES.conversations(),
] as const;

export const Route = createFileRoute("/")({
	component: DashboardRoute,
	loader: async ({ context }) => {
		const { queryClient } = context;

		await Promise.all([
			queryClient.ensureQueryData(PORTFOLIO_QUERIES.history()),
			queryClient.ensureQueryData(MARKET_QUERIES.prices(SUPPORTED_MARKETS)),
			...DASHBOARD_PREFETCHES.map((options) =>
				queryClient.ensureQueryData(options),
			),
		]);
	},
});

function DashboardRoute() {
	const isMobile = useMediaQuery("(max-width: 1023px)", {
		defaultValue: false,
	});
	const { value: isSidebarExpanded, toggle: toggleSidebar } = useBoolean(false);

	const contentWidth = isMobile ? "100%" : "calc(100% - 384px)";

	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			<LightRays />
			<Header
				isSidebarExpanded={isSidebarExpanded}
				onToggleSidebar={toggleSidebar}
			/>
			<div className="relative flex min-h-0 flex-1">
				<div
					className="flex min-h-0 flex-1 flex-col"
					style={{ width: contentWidth, maxWidth: contentWidth }}
				>
					<CryptoTracker />
					<div className="min-h-0 flex-1">
						<PerformanceGraph />
					</div>
				</div>
				<TradesSidebar isExpanded={isSidebarExpanded} isMobile={isMobile} />
			</div>
		</div>
	);
}
