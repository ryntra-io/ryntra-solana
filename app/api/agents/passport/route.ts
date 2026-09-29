import { fetchAgentverseAgentPassport } from "../../../../lib/agent-control/adapters/agentverse.ts";
import { withAgentControlRoute } from "../../../../lib/agent-control/route-gate.ts";

import { createAgentPassportGetHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passportHandler = createAgentPassportGetHandler({
  fetchPassport: fetchAgentverseAgentPassport,
});

export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/passport" },
  (request) => passportHandler(request),
);
