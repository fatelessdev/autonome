import { createFileRoute } from "@tanstack/react-router";

import SimulatorPanel from "@/components/simulator/SimulatorPanel";
import { orpc } from "@/server/orpc/client";

export const Route = createFileRoute("/simulator")({
	component: SimulatorRoute,
	loader: async ({ context }) => {
		const { queryClient } = context;

		// Prefetch models list for account selection
		await queryClient.prefetchQuery(
			orpc.models.getModels.queryOptions({
				input: {},
			}),
		);
	},
});

function SimulatorRoute() {
	return (
		<div className="relative min-h-screen w-full bg-background">
			<div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8">
				<header className="mb-6 space-y-3">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-primary">
								Exchange Simulator
							</p>
							<h1 className="text-2xl font-bold tracking-tight text-foreground">
								Trading Dashboard
							</h1>
						</div>
						<div className="hidden md:block">
							<div className="rounded-full border border-dashed border-border/60 px-4 py-2 text-xs text-muted-foreground">
								Real-time market simulation
							</div>
						</div>
					</div>
					<p className="text-sm text-muted-foreground">
						Monitor positions, analyze trades, and execute orders in a simulated
						exchange environment.
					</p>
				</header>

				<SimulatorPanel />
			</div>
		</div>
	);
}
