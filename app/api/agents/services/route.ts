import { withAgentControlRoute } from "../../../../lib/agent-control/route-gate.ts";

import { createServicesCatalogueHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const catalogueHandler = createServicesCatalogueHandler();

export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/services" },
  async () => catalogueHandler(),
);
