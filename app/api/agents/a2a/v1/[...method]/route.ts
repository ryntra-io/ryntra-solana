import { withAgentControlRoute } from "../../../../../../lib/agent-control/route-gate.ts";

import { createA2aInterfaceHandler, type A2aRouteContext } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createA2aInterfaceHandler();

export const GET = withAgentControlRoute<A2aRouteContext>(
  { route: "/api/agents/a2a/v1" },
  async (request, context) => handler(request, context),
);

export const POST = withAgentControlRoute<A2aRouteContext>(
  { route: "/api/agents/a2a/v1" },
  async (request, context) => handler(request, context),
);
