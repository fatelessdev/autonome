import "@/polyfill";

import { createFileRoute } from "@tanstack/react-router";

import { handleSimOrder } from "@/server/features/simulator/api";

const handlePost = ({ request }: { request: Request }) =>
	handleSimOrder(request);

export const Route = createFileRoute("/api/sim/order")({
	server: {
		handlers: {
			POST: handlePost,
		},
	},
});
