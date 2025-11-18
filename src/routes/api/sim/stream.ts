import "@/polyfill";

import { createFileRoute } from "@tanstack/react-router";

import { handleSimStream } from "@/server/features/simulator/api";

const handleGet = ({ request }: { request: Request }) =>
	handleSimStream(request);

export const Route = createFileRoute("/api/sim/stream")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
