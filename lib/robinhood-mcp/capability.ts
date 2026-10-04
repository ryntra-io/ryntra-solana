/* Robinhood Trading MCP capability register (read-only discovery).

   **This direction is CANCELLED and this register is a finished artifact.** On
   2026-08-24 Ryntra decided that Robinhood Trading MCP, Robinhood Brokerage and
   the Robinhood Agentic Account are not a current product dependency and will
   not be pursued (`resolution: OWNER_NO_GO`). Where a record below says that
   what Ryntra lacks is an account, read it as a measurement rather than as an
   intention: nobody is obtaining one, and no successor is queued.

   Robinhood Chain Markets + Arcus is a different vertical, unaffected by that
   decision, and does not depend on anything in this file.

   Two things this file prevents.

   First, discovery work promoting itself into a shipped capability. Nothing
   here is implemented against. Every `ryntra` axis is `planned` or `blocked`, and
   the suite fails the build if any record claims otherwise.

   Second — and this is the one specific to Robinhood — a control claim on a path
   Ryntra is not on. The customer's agent speaks to `agent.robinhood.com`
   directly; Ryntra is nowhere in that request. So every record carries an
   `enforcementMode`, it is derived from the topology rather than written, and on
   this surface it is `OBSERVED_EXTERNALLY` for all of them.

   The register is honest about a third thing by omission: not one row here was
   reached over the MCP transport. The endpoint refuses this egress at the CDN
   edge, so `source` is `official-docs` where Robinhood published the fact and
   `unverified` where it did not. The single `live-probe` in this file is the
   refusal itself. */

import type { CapabilityState } from "../domain/capability.ts";
import { RYNTRA_ROBINHOOD_MCP_ENFORCEMENT, type RyntraEnforcementMode } from "./enforcement.ts";

const DISCOVERED = "2026-08-24";

export type RobinhoodMcpCapability = {
  id: string;
  title: string;
  /** Which documented tool family would serve it. */
  family: string;
  state: CapabilityState;
  enforcementMode: RyntraEnforcementMode;
  /** Constant false across this register: nothing here has spoken to the venue. */
  reachedOverMcp: boolean;
  evidence: readonly string[];
};

/**
 * Documented by the provider, never called, unbuilt by Ryntra.
 *
 * `protocol: "live"` is the venue's own claim about itself and is sourced to the
 * page that makes it.
 *
 * `user: "unknown"` and deliberately not `restricted`. The first version said
 * restricted, because the development workstation is refused at the CDN edge —
 * and then Ryntra's production egress answered `401` with a full OAuth
 * challenge, so the refusal turned out to belong to one origin rather than to
 * this product. What actually stops Ryntra acting is that it holds no Robinhood
 * account, and `restricted` would blame a jurisdiction for an absence of an
 * account.
 */
function documented(reason: string): CapabilityState {
  return {
    protocol: "live",
    ryntra: "planned",
    user: "unknown",
    verifiedAt: DISCOVERED,
    source: "official-docs",
    reason,
  };
}

/** Documented as a write. Ryntra is `blocked` on all of them, by design and by absence of a path. */
function documentedWrite(reason: string): CapabilityState {
  return {
    protocol: "live",
    ryntra: "blocked",
    user: "unknown",
    verifiedAt: DISCOVERED,
    source: "official-docs",
    reason,
  };
}

const EVIDENCE_TOOLS = "docs: robinhood.com/us/en/support/articles/trading-with-your-agent (2026-08-24)";
const EVIDENCE_OVERVIEW = "docs: robinhood.com/us/en/support/articles/agentic-trading-overview (2026-08-24)";
const EVIDENCE_PROBE = "fixture: lib/robinhood-mcp/fixtures/reachability-probe.json";

export const ROBINHOOD_MCP_CAPABILITIES: readonly RobinhoodMcpCapability[] = [
  {
    id: "robinhood-mcp-transport",
    title: "MCP Streamable HTTP transport",
    family: "transport",
    state: {
      protocol: "live",
      ryntra: "blocked",
      user: "unknown",
      verifiedAt: DISCOVERED,
      source: "live-probe",
      reason:
        "Two origins, two answers, and both were measured. From the development workstation every " +
        "path of the host returns 403 at the CloudFront edge — \"Your request has been blocked due " +
        "to originating from a jurisdiction restricted by US sanctions. Please contact Robinhood " +
        "support for more information.\" — the venue's own words, not a summary of them. From " +
        "Ryntra's production egress the same handshake returns 401 with an RFC 9728 challenge " +
        "naming the protected-resource document, and both discovery documents return 200. The " +
        "transport is therefore reachable and gated, not closed; what Ryntra lacks is an account.",
    },
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_PROBE, EVIDENCE_OVERVIEW],
  },
  {
    id: "robinhood-mcp-account-read",
    title: "Read every Robinhood account the customer holds",
    family: "account",
    state: documented(
      "The provider states the agent has read access to all Robinhood accounts including account " +
        "numbers, positions, balances, transactions, order history, watchlists and scans. Ryntra " +
        "has no adapter, no credential and no imported account on this surface.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_OVERVIEW, EVIDENCE_TOOLS],
  },
  {
    id: "robinhood-mcp-portfolio-read",
    title: "Portfolio snapshot, buying power and realized P&L",
    family: "account",
    state: documented(
      "Four documented read tools cover portfolio value by asset class, real-time buying power and " +
        "trade-by-trade realized P&L. None was reached; the inventory is documentation-sourced.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_TOOLS],
  },
  {
    id: "robinhood-mcp-market-data",
    title: "Quotes, order book, fundamentals, earnings and indicators",
    family: "market-data",
    state: documented(
      "Nine documented market-data tools, including a real-time Level 2 book for up to four " +
        "symbols. Whether any of them returns what its description says is unverified, because the " +
        "transport was never reached.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_TOOLS],
  },
  {
    id: "robinhood-mcp-order-history",
    title: "Order status history across equities, options and crypto",
    family: "orders",
    state: documented(
      "Three documented read tools return order history per asset class. This is the read that a " +
        "reconciliation product would actually need, and it is the one worth wanting.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_TOOLS],
  },
  {
    id: "robinhood-mcp-order-simulation",
    title: "Pre-trade simulation and warnings",
    family: "orders",
    state: documented(
      "review_equity_order, review_option_order and preview_crypto_order simulate an order and " +
        "return the venue's own pre-trade warnings without creating anything. They are reads, and " +
        "they are the closest thing this surface has to a Ryntra preflight.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_TOOLS],
  },
  {
    id: "robinhood-mcp-order-placement",
    title: "Place and cancel real orders in the Agentic account",
    family: "orders",
    state: documentedWrite(
      "Six documented write tools across three asset classes, confined by the provider to the " +
        "Agentic account. Ryntra is blocked here and would remain blocked with a working " +
        "credential: no request would pass through Ryntra, so nothing here could refuse one.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_TOOLS, EVIDENCE_OVERVIEW],
  },
  {
    id: "robinhood-mcp-watchlist-write",
    title: "Create and edit watchlists and saved scans",
    family: "watchlist",
    state: documentedWrite(
      "Eighteen documented writes that hold no assets. Recorded separately from order writes so " +
        "that a control which refuses a market order does not have to refuse a rename with the " +
        "same sentence.",
    ),
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_TOOLS],
  },
  {
    id: "robinhood-mcp-oauth",
    title: "OAuth authorization of an agent",
    family: "authorization",
    state: {
      protocol: "live",
      ryntra: "blocked",
      user: "unknown",
      verifiedAt: DISCOVERED,
      source: "live-probe",
      reason:
        "The provider's four official pages name no grant, scope, token, rate limit or revocation " +
        "semantic, so the documentation establishes none of it. The two metadata documents do, and " +
        "they answered Ryntra's production egress: authorization code with S256 only, a public " +
        "client, a refresh grant, open dynamic registration, one opaque scope and no revocation " +
        "endpoint. Completing a grant is still a desktop-only human flow against an account Ryntra " +
        "does not have.",
    },
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [EVIDENCE_PROBE, EVIDENCE_OVERVIEW],
  },
  {
    id: "robinhood-mcp-emergency-stop",
    title: "Revocation and emergency stop",
    family: "authorization",
    state: {
      protocol: "live",
      ryntra: "planned",
      user: "unknown",
      verifiedAt: DISCOVERED,
      source: "live-probe",
      reason:
        "The provider offers one control and it is a human one: disconnect the agent in the " +
        "Robinhood app. Push notification on each trade is the detection half. The absence of a " +
        "programmatic alternative is now measured rather than assumed — the RFC 8414 document " +
        "publishes no revocation_endpoint, so there is no RFC 7009 path to revoke an agent's " +
        "token, and the in-app disconnect is the whole of it.",
    },
    enforcementMode: RYNTRA_ROBINHOOD_MCP_ENFORCEMENT,
    reachedOverMcp: false,
    evidence: [
      "docs: robinhood.com/us/en/agentic-trading (2026-08-24)",
      "docs: robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents (2026-05-27)",
    ],
  },
];

export function capabilityById(id: string): RobinhoodMcpCapability {
  const found = ROBINHOOD_MCP_CAPABILITIES.find(function (capability) { return capability.id === id; });
  if (!found) {
    throw new Error(
      "Unknown capability " + id + ". This register holds only what a source establishes; " +
        "an id with no record behind it is a question, not a capability.",
    );
  }
  return found;
}

/**
 * The refusal, as its own record.
 *
 * It is the one record in this register that was established by a live probe, and
 * keeping it separate is what lets every other record honestly say it was not.
 */
export function jurisdictionRecord(): RobinhoodMcpCapability {
  return capabilityById("robinhood-mcp-transport");
}

export type OAuthLifecycleStep = {
  id: string;
  label: string;
  /** `VERIFIED_ABSENT` is a finding, not a gap: the standard's document omits it. */
  state: "VERIFIED" | "VERIFIED_ABSENT" | "UNVERIFIED";
  /** Where it was established. Absent on an `UNVERIFIED` step, which has no source. */
  source?: "live-probe";
  finding: string;
};

/**
 * The lifecycle, measured.
 *
 * **This section said the opposite one commit earlier, and the correction is the
 * register's most useful finding.** From the development workstation every path of
 * `agent.robinhood.com` is refused at the CDN edge, so the first version recorded
 * all six cells as `UNVERIFIED` and said so structurally: the documentation names
 * no OAuth detail and the metadata documents could not be read. The first half is
 * still true. The second was true only of that origin — Ryntra's production
 * egress receives `401` with a full RFC 9728 challenge on the transport and `200`
 * on both discovery documents. The claim is corrected in the change that
 * made it false.
 *
 * Everything below comes from the two documents RFC 8414 and RFC 9728 intend to
 * be read unauthenticated, captured in `fixtures/production-probe.json`. Nothing
 * below required an account, a credential or a grant, and none was obtained.
 */
export const OAUTH_LIFECYCLE: readonly OAuthLifecycleStep[] = [
  {
    id: "registration",
    label: "Client registration",
    state: "VERIFIED",
    source: "live-probe",
    finding:
      "RFC 7591 dynamic client registration is offered, at " +
      "https://agent.robinhood.com/oauth/trading/register. Any MCP client can register itself, " +
      "which is what makes 'paste one URL into your agent' work — and it means the set of clients " +
      "that may ask a customer for this grant is open rather than curated.",
  },
  {
    id: "authorization",
    label: "Authorization request and PKCE",
    state: "VERIFIED",
    source: "live-probe",
    finding:
      "Authorization code only, at https://robinhood.com/oauth, with S256 as the sole code " +
      "challenge method and no plain fallback. token_endpoint_auth_methods_supported is [\"none\"], " +
      "so this is a public client and PKCE is the whole of the client's proof. Completing the flow " +
      "is a desktop-only human step, per the provider's documentation.",
  },
  {
    id: "token",
    label: "Token issuance",
    state: "VERIFIED",
    source: "live-probe",
    finding:
      "The token endpoint is https://api.robinhood.com/oauth2/token/ — the brokerage's own API " +
      "host, and the same host the Stock Token API lives on. The issuer is the resource URL " +
      "itself, https://agent.robinhood.com/mcp/trading, rather than an origin. Token lifetime is " +
      "not published in the metadata and remains unknown.",
  },
  {
    id: "refresh",
    label: "Refresh",
    state: "VERIFIED",
    source: "live-probe",
    finding:
      "grant_types_supported is [\"authorization_code\", \"refresh_token\"], so an agent session is " +
      "durable and expiry does not force a fresh desktop authorization. This is the opposite of " +
      "Binance, where its MCP discovery found no refresh grant and concluded that any assumption of " +
      "a long-lived agent session was wrong. Here that assumption holds.",
  },
  {
    id: "scopes",
    label: "Scopes",
    state: "VERIFIED",
    source: "live-probe",
    finding:
      "scopes_supported is exactly [\"internal\"] in both documents — a single opaque scope that " +
      "describes nothing. The documented split between reading every account and writing only the " +
      "Agentic one is therefore enforced by the account model and by nothing the customer or the " +
      "client can narrow: there is no read-only authorization to ask for, and consenting to " +
      "reading is consenting to trading. bearer_methods_supported is [\"header\"].",
  },
  {
    id: "revocation",
    label: "Revocation",
    state: "VERIFIED_ABSENT",
    source: "live-probe",
    finding:
      "No revocation_endpoint and no introspection_endpoint appear in the RFC 8414 document, so " +
      "there is no RFC 7009 way to revoke an agent's token and no way to ask whether one is still " +
      "live. Stopping an agent is the in-app disconnect and nothing else — which matches what the " +
      "provider says in words, and is now an absence that was looked for rather than one that was " +
      "assumed.",
  },
  {
    id: "revocation-latency",
    label: "How fast a disconnect reaches an in-flight call",
    state: "UNVERIFIED",
    finding:
      "Unpublished in the metadata and unstated in the documentation. It matters because the " +
      "in-app disconnect is the only stop that exists, and needs an authorized session to measure.",
  },
];

export type ProductRecord = {
  id: string;
  label: string;
  providerState: "AVAILABLE" | "NOT_DOCUMENTED";
  orderTypes: readonly string[];
  limitation: string;
  evidence: readonly string[];
};

/**
 * What the agent can trade, taken from the tool tables that exist today rather
 * than from the launch announcement.
 *
 * The May 2026 post said equities only, with options, crypto, event contracts and
 * futures "coming soon". Three months later the tool tables carry equities,
 * options and crypto and carry neither futures nor event contracts. Recording the
 * announcement's list would have been recording a roadmap as a capability.
 *
 * Order types are the brokerage's own, from the order-types article the agentic
 * overview links to. Which subset the MCP tools actually accept is unverified —
 * the tool descriptions name no order type.
 */
export const ROBINHOOD_MCP_PRODUCTS: readonly ProductRecord[] = [
  {
    id: "equities",
    label: "Equities (long only)",
    providerState: "AVAILABLE",
    orderTypes: ["market", "limit", "stop", "stop limit", "trailing stop"],
    limitation:
      "Long only, per the provider. Market orders are good-for-day; other types may be " +
      "good-for-day or good-til-canceled. Bracket, market-on-close and market-on-open are not " +
      "supported by the brokerage at all. Which of these the MCP tools accept is unverified.",
    evidence: [EVIDENCE_TOOLS, "docs: robinhood.com/us/en/support/articles/order-types (2026-08-24)"],
  },
  {
    id: "options",
    label: "Options (long only)",
    providerState: "AVAILABLE",
    orderTypes: ["market", "limit", "stop limit", "stop market"],
    limitation:
      "Long only. Requires options trading access on the account; the agent can only fetch a link " +
      "to apply for it, never grant it.",
    evidence: [EVIDENCE_TOOLS, "docs: robinhood.com/us/en/support/articles/order-types (2026-08-24)"],
  },
  {
    id: "crypto",
    label: "Crypto",
    providerState: "AVAILABLE",
    orderTypes: ["market", "limit", "stop", "stop limit"],
    limitation:
      "Requires a Robinhood Crypto account corresponding to the Agentic account and acceptance of " +
      "the updated agreement; the agent cannot open one. Trading only — the agent cannot transfer, " +
      "stake or lend. Agentic crypto trading is not available in every state, including New York; " +
      "moving to a restricted state stops new agent crypto orders without cancelling open ones, " +
      "and access is restored 45 days after moving back.",
    evidence: [EVIDENCE_OVERVIEW, EVIDENCE_TOOLS],
  },
  {
    id: "futures",
    label: "Futures",
    providerState: "NOT_DOCUMENTED",
    orderTypes: [],
    limitation:
      "Named as coming soon in the May 2026 launch announcement and absent from every current tool " +
      "table. Recorded as not documented rather than as pending.",
    evidence: ["docs: robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents (2026-05-27)", EVIDENCE_TOOLS],
  },
  {
    id: "event-contracts",
    label: "Event contracts",
    providerState: "NOT_DOCUMENTED",
    orderTypes: [],
    limitation:
      "Named as coming soon in the May 2026 launch announcement and absent from every current tool " +
      "table.",
    evidence: ["docs: robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents (2026-05-27)", EVIDENCE_TOOLS],
  },
];
