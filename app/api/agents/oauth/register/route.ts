import { AgentOAuthError, createAgentOAuthServer } from "../../../../../lib/agent-control/oauth/server.ts";
import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";
import { getAgentControlRuntime } from "../../../../../lib/agent-control/runtime.ts";
import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 7591 dynamic client registration.
 *
 * Open registration is what makes a connector paste-a-URL simple, and it is
 * also the endpoint most worth bounding. Three bounds do that here and none of
 * them is a configuration flag:
 *
 * - a registered client is **public**, so this endpoint mints no secret and
 *   there is nothing to leak from a registration that was never used;
 * - registration grants **nothing**. A client id is a name. Every scope comes
 *   later, from a human presenting a Ryntra key at the approval step, so a
 *   thousand registrations are a thousand names and zero access;
 * - the anonymous durable quota applies, because `withAgentControlRoute` wraps
 *   it like every other route.
 */
export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/oauth/register" },
  async (request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "invalid_request", error_description: "The registration body is not JSON." },
        { status: 400, headers: privateNoStoreHeaders() },
      );
    }

    try {
      const { clientId, record } = await createAgentOAuthServer(
        getAgentControlRuntime().guardStore,
      ).registerClient({ request: body, nowMs: Date.now() });

      return Response.json(
        {
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.parse(record.createdAt) / 1_000),
          client_name: record.clientName,
          redirect_uris: record.redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        { status: 201, headers: privateNoStoreHeaders() },
      );
    } catch (error) {
      if (error instanceof AgentOAuthError) {
        return Response.json(
          { error: error.code, error_description: error.message },
          { status: error.status, headers: privateNoStoreHeaders() },
        );
      }
      throw error;
    }
  },
);
