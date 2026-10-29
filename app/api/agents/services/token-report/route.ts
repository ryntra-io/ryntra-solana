import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";

import { createTokenReportHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenReportHandler = createTokenReportHandler();

export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/services/token-report" },
  (request) => tokenReportHandler(request),
);
