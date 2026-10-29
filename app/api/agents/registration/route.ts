import { withAgentControlRoute } from "../../../../lib/agent-control/route-gate.ts";

import { createRegistrationHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createRegistrationHandler();

export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/registration" },
  async (request) => handler(request),
);
