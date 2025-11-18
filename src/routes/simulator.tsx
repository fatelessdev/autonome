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
    <div className="relative min-h-screen w-full bg-background px-4 py-10 md:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Simulator
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Exchange Control Room
              </h1>
              <p className="text-sm text-muted-foreground">
                Route simulated orders, inspect account telemetry, and watch
                order books update in real time.
              </p>
            </div>
            <div className="rounded-full border border-dashed border-border/60 px-4 py-2 text-xs text-muted-foreground">
              Backed by Autonome&apos;s Lighter-inspired simulator APIs
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-border/60 bg-card/70 p-6 shadow-xl backdrop-blur">
          <SimulatorPanel />
        </section>
      </div>
    </div>
  );
}
