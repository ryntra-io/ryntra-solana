import { withAgentControlRoute } from "../../../../lib/agent-control/route-gate.ts";

import { createProcurementHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const procurementHandler = createProcurementHandler();

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/procurement" },
  (request) => procurementHandler(request),
);
