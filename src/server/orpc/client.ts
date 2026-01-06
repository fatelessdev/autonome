import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { getRpcUrl } from "@/core/shared/api/apiConfig";
import type router from "@/server/orpc/router";

const link = new RPCLink({
	url: getRpcUrl(),
});

export const client: RouterClient<typeof router> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
