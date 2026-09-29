import { createAgentControlDemo } from "@/lib/agent-control/demo";
import { withAgentControlRoute } from "@/lib/agent-control/route-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/demo" },
  async (_request, _context, gate) =>
    Response.json({ data: createAgentControlDemo() }, { headers: gate.headers }),
);
