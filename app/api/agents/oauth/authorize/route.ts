import {
  AgentOAuthError,
  createAgentOAuthServer,
  parseScopeString,
} from "../../../../../lib/agent-control/oauth/server.ts";
import { mcpResourceIdentifier } from "../../../../../lib/agent-control/oauth/metadata.ts";
import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";
import { getAgentControlRuntime } from "../../../../../lib/agent-control/runtime.ts";
import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The approval step — where a person, holding a Ryntra key, decides.
 *
 * The consent screen at `/agents/connect` posts here. This route never renders
 * anything: it validates the request against the registered client, verifies
 * the key, mints one short-lived code and sends the browser back to the client.
 *
 * **A refusal never redirects.** OAuth's own error redirect is convenient and
 * wrong for the two failures that matter here — an unregistered client and an
 * unregistered redirect URI — because bouncing the browser to an address this
 * server has not vouched for is how an open redirector is built. Those two are
 * answered here, in Ryntra's own page. Everything after them is a decision the
 * registered client is entitled to hear about, and travels back on the
 * registered redirect.
 */
function refuse(status: number, code: string, message: string) {
  return Response.json(
    { error: code, error_description: message },
    { status, headers: privateNoStoreHeaders() },
  );
}

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/oauth/authorize" },
  async (request) => {
    const form = await request.formData().catch(() => null);
    if (!form) return refuse(400, "invalid_request", "The approval must be a form submission.");

    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };

    const clientId = text("client_id");
    const redirectUri = text("redirect_uri");
    const state = text("state");
    const codeChallenge = text("code_challenge");
    const codeChallengeMethod = text("code_challenge_method") || "S256";
    const apiKey = text("api_key");
    const resource = text("resource") || mcpResourceIdentifier(request);

    const oauth = createAgentOAuthServer(getAgentControlRuntime().guardStore);

    /* Client and redirect are checked before anything is echoed anywhere. */
    const client = await oauth.readClient(clientId);
    if (!client) return refuse(401, "invalid_client", "No such client is registered.");
    if (!client.redirectUris.includes(redirectUri)) {
      return refuse(400, "invalid_request", "That redirect URI is not registered for this client.");
    }

    let scopes;
    try {
      scopes = parseScopeString(text("scope"));
    } catch (error) {
      return error instanceof AgentOAuthError
        ? refuse(400, error.code, error.message)
        : refuse(400, "invalid_scope", "The requested scope is not accepted.");
    }

    try {
      const { code } = await oauth.approve({
        clientId,
        apiKey,
        requestedScopes: scopes,
        redirectUri,
        resource,
        codeChallenge,
        codeChallengeMethod,
        nowMs: Date.now(),
      });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      if (state) target.searchParams.set("state", state);
      return new Response(null, {
        status: 303,
        headers: { ...privateNoStoreHeaders(), Location: target.toString() },
      });
    } catch (error) {
      if (error instanceof AgentOAuthError) {
        /* A wrong key is the one failure a person will actually hit, and it is
           theirs to fix — so it is answered here rather than bounced to a
           connector that would show its own generic screen. */
        return refuse(error.status, error.code, error.message);
      }
      throw error;
    }
  },
);
