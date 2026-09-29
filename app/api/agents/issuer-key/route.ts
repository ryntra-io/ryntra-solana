import { loadIssuerKey, publishedIssuerKey } from "@/lib/agent-control/issuer";
import { withAgentControlRoute } from "@/lib/agent-control/route-gate";
import { privateNoStoreHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The published verification key.
 *
 * A signature nobody can check is decoration, so the key a verifier needs has
 * to be fetchable from a stable place. This is that place, and it serves the
 * public half only — the private half lives in an environment secret this
 * process reads and never returns.
 *
 * With no key configured it answers `NOT_CONFIGURED` rather than 404, because
 * "this deployment signs nothing" is a fact worth stating, and a missing route
 * would leave a reader guessing between that and a broken one.
 */
export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/issuer-key" },
  async () =>
    Response.json(
      { data: publishedIssuerKey(loadIssuerKey()) },
      { headers: privateNoStoreHeaders() },
    ),
);
