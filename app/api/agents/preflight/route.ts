import { z } from "zod";

import { AgentActionIntentSchema } from "@/lib/agent-control/contracts";
import { createAgentControlDemo } from "@/lib/agent-control/demo";
import { readAgentControlJson } from "@/lib/agent-control/http";
import { withAgentControlRoute } from "@/lib/agent-control/route-gate";
import { privateNoStoreHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z
  .object({
    intent: AgentActionIntentSchema,
    recordDemoDecision: z.boolean().default(false),
  })
  .strict();

/*
 * The rate decision no longer travels through this file. `withAgentControlRoute`
 * authenticates, meters against the durable quota and writes the advertised
 * `RateLimit-*` headers onto whatever this handler returns — so a response
 * built here carries only the cache policy, and the numbers a caller reads come
 * from the counter that actually decided.
 */
function failure(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: privateNoStoreHeaders() },
  );
}

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/preflight" },
  async (request) => {
    const body = await readAgentControlJson(request);
    if (!body.ok) return failure(body.status, body.code, "The request body is not accepted.");

    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return failure(400, "VALIDATION_ERROR", "The intent does not match AgentActionIntent 1.0.0.");
    }

    try {
      return Response.json(
        {
          data: createAgentControlDemo({
            intent: parsed.data.intent,
            recordDemoDecision: parsed.data.recordDemoDecision,
          }),
        },
        { headers: privateNoStoreHeaders() },
      );
    } catch {
      return failure(400, "PREFLIGHT_REJECTED", "The source preview could not be constructed.");
    }
  },
);
