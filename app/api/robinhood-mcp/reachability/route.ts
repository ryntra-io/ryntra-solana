import { publicCacheHeaders } from "@/lib/http-control";
import { probeRobinhoodMcp } from "@/lib/robinhood-mcp/probe";
import { ROBINHOOD_MCP_URL } from "@/lib/robinhood-mcp/reachability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the Robinhood Trading MCP answers Ryntra's own egress.
 *
 * `RYN-RHC-001` closed with this exact unknown recorded in `docs/STATE.md`: the
 * development machine receives a regional `403` from `api.robinhood.com`, the surfaces that would have shown the deployment's
 * answer are account-gated, and so nobody had measured whether Vercel's egress
 * gets a different one. `RYN-RH-MCP-001` found the same refusal on
 * `agent.robinhood.com` — the transport and both OAuth discovery documents alike
 * — and this route is how the second half of that question gets an answer that is
 * measured rather than assumed.
 *
 * **It reads nothing from the request.** The three URLs are module constants in
 * `lib/robinhood-mcp/reachability.ts`; there is no host, path, header or query
 * parameter a caller can supply. That is the property every write schema in
 * `RYN-AGENT-CONTROL-013` holds, applied to the one outbound call this packet
 * makes, and it is what keeps a public reachability record from becoming an open
 * relay for whoever finds it.
 *
 * **Caller volume is not upstream volume.** The result is memoized per instance
 * for five minutes and served with a public cache header, so a thousand requests
 * cost Robinhood the same three calls one request does.
 *
 * **It carries no credential and returns no venue data.** A refusal is reported
 * in the provider's own sentence; an answered body is discarded unread, because
 * this asks whether a door opens and is not a reader of what is behind it.
 */
export async function GET() {
  const report = await probeRobinhoodMcp();
  return Response.json(
    {
      surface: "robinhood-trading-mcp",
      endpoint: ROBINHOOD_MCP_URL,
      state: report.state,
      discoveryPossible: report.discoveryPossible,
      observedAt: report.observedAt,
      cached: report.cached,
      observed: report.observed.map((entry) => ({
        id: entry.id,
        url: entry.url,
        httpStatus: entry.httpStatus,
        state: entry.state,
        providerMessage: entry.providerMessage,
        sentence: entry.sentence,
        /* A challenge is a question the server asks, not an answer anybody gave
           it, so it carries no credential — and it is the one header that proves
           an endpoint is a protected OAuth resource rather than a closed door. */
        challenge: entry.challenge ?? null,
        /* Only the fields RFC 8414 and RFC 9728 define, from documents both
           standards intend to be read unauthenticated. */
        metadata: entry.metadata ?? null,
      })),
      boundary:
        "Ryntra ships no Robinhood brokerage adapter. Nothing here holds a credential, opens an " +
        "Agentic account or places an order, and no control on this surface is enforced through " +
        "Ryntra.",
    },
    { headers: publicCacheHeaders(60, 300) },
  );
}
