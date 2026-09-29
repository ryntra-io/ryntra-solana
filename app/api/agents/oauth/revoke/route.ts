import { createAgentOAuthServer } from "../../../../../lib/agent-control/oauth/server.ts";
import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";
import { getAgentControlRuntime } from "../../../../../lib/agent-control/runtime.ts";
import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 7009 revocation.
 *
 * An unknown token answers `200`, which looks careless and is the specification
 * being careful: an endpoint that said "unknown" would let anyone test guesses
 * against it. What matters is the other half — a token this server does know is
 * durably marked, and the very next call it is presented on is refused.
 */
export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/oauth/revoke" },
  async (request) => {
    const form = await request.formData().catch(() => null);
    const token = form && typeof form.get("token") === "string" ? String(form.get("token")) : "";
    await createAgentOAuthServer(getAgentControlRuntime().guardStore).revoke({
      token,
      nowMs: Date.now(),
    });
    return new Response(null, { status: 200, headers: privateNoStoreHeaders() });
  },
);
