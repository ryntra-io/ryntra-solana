import { AgentOAuthError, createAgentOAuthServer } from "../../../../../lib/agent-control/oauth/server.ts";
import { mcpResourceIdentifier } from "../../../../../lib/agent-control/oauth/metadata.ts";
import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";
import { getAgentControlRuntime } from "../../../../../lib/agent-control/runtime.ts";
import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 6749 token endpoint, restricted to the two grants this server issues.
 *
 * There is no client authentication because there is no client secret: a public
 * client proves possession of the authorization by producing the PKCE verifier
 * whose challenge it published before the code existed. That is the whole
 * proof, and it is checked inside the server module rather than here.
 */
function refuse(error: AgentOAuthError) {
  return Response.json(
    { error: error.code, error_description: error.message },
    { status: error.status, headers: privateNoStoreHeaders() },
  );
}

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/oauth/token" },
  async (request) => {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return refuse(new AgentOAuthError("invalid_request", "The token request must be form-encoded."));
    }
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };

    const oauth = createAgentOAuthServer(getAgentControlRuntime().guardStore);
    const grantType = text("grant_type");
    const resource = text("resource") || mcpResourceIdentifier(request);

    try {
      const pair =
        grantType === "authorization_code"
          ? await oauth.exchangeCode({
              code: text("code"),
              clientId: text("client_id"),
              redirectUri: text("redirect_uri"),
              codeVerifier: text("code_verifier"),
              resource,
              nowMs: Date.now(),
            })
          : grantType === "refresh_token"
            ? await oauth.refresh({
                refreshToken: text("refresh_token"),
                clientId: text("client_id"),
                resource,
                nowMs: Date.now(),
              })
            : null;

      if (!pair) {
        return refuse(
          new AgentOAuthError("unsupported_grant_type", `${grantType || "none"} is not a supported grant.`),
        );
      }

      return Response.json(
        {
          access_token: pair.accessToken,
          token_type: "Bearer",
          expires_in: pair.expiresInSeconds,
          refresh_token: pair.refreshToken,
          scope: pair.scopes.join(" "),
        },
        { headers: privateNoStoreHeaders() },
      );
    } catch (error) {
      if (error instanceof AgentOAuthError) return refuse(error);
      throw error;
    }
  },
);
