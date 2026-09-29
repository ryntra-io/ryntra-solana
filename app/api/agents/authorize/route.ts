import { getAgentControlRuntime } from "@/lib/agent-control/runtime";
import { withAgentControlRoute } from "@/lib/agent-control/route-gate";
import { privateNoStoreHeaders } from "@/lib/http-control";

import { createAgentAuthorizePostHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(null, {
    status: 405,
    headers: { ...privateNoStoreHeaders(), Allow: "POST" },
  });
}

const authorizeHandler = createAgentAuthorizePostHandler({
  getRuntime: getAgentControlRuntime,
});

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/authorize" },
  (request) => authorizeHandler(request),
);
