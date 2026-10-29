import { withAgentControlRoute } from "../../../../lib/agent-control/route-gate.ts";

import { createRouterQuoteHandler, createRouterReadHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const read = createRouterReadHandler();
const quote = createRouterQuoteHandler();

export const GET = withAgentControlRoute<unknown>({ route: "/api/agents/router" }, async () => read());

export const POST = withAgentControlRoute<unknown>({ route: "/api/agents/router" }, async (request) =>
  quote(request),
);
