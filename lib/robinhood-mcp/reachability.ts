/* Whether the Robinhood Trading MCP answers at all.

   This is the package's first gate and it is pure classification: given a status,
   say what it means, and never let an absence of an answer read as permission.

   The targets are module constants. Nothing here accepts a host, url, path or
   header from a caller — which is the property Agent Control's MCP server held
   across all twelve of its write schemas, and the reason the probe route built on
   this module cannot be turned into an open relay by anyone who finds it.

   There is also no way to disguise where a request came from: no intermediary
   option, no forwarded-address header, no tunnelling suggestion. The test scans
   this file for each of those words and fails on any of them, which is the same
   absence `lib/rwa/rhj/client.ts` already asserts for the Stock Token API.
   Robinhood's terms prohibit masking, and a venue answers for itself: Ryntra
   shows that answer as it comes back. */

/** The published Trading MCP endpoint. */
export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

export type ReachabilityState =
  /** The transport answered 2xx. Only this permits discovery. */
  | "REACHABLE"
  /** 403/451 — the venue refused this origin. */
  | "JURISDICTION_BLOCKED"
  /** 401 — the server exists, is speaking, and wants a credential. */
  | "AUTHENTICATION_REQUIRED"
  /** 429 — the venue answered, and asked to be asked later. */
  | "RATE_LIMITED"
  /** Any other status. The venue said something, and it was not yes. */
  | "REFUSED"
  /** No answer at all: timeout, DNS, TLS, aborted. */
  | "UNREACHABLE";

export type ProbeTarget = {
  id: string;
  url: string;
  method: "GET" | "POST";
  /** `oauth-metadata` documents are read into standard fields; the transport never is. */
  kind: "transport" | "oauth-metadata";
  /** What this target would prove if it answered. */
  proves: string;
};

/**
 * The handshake, and nothing about anybody.
 *
 * A fixed JSON-RPC `initialize` with an empty capability set and a client name
 * that says what it is. It is the smallest request that makes the transport
 * answer as a transport rather than as a web server.
 */
export const MCP_INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "ryntra-reachability-probe", version: "0.0.0" },
  },
});

/**
 * Three targets, chosen so that a single status cannot be mistaken for a
 * narrower fact. The transport is the product; the two discovery documents are
 * what an MCP client fetches before it ever authenticates.
 *
 * **The method is per target and the prober honours it.** The first version
 * declared a method here and then sent `GET` to all three, and production
 * answered `405 method not allowed` on the transport — a true statement about a
 * `GET` that says nothing about whether the endpoint would answer a client. A
 * probe whose request does not match what it claims to be probing measures
 * itself.
 */
export const PROBE_TARGETS: readonly ProbeTarget[] = [
  {
    id: "mcp-transport",
    url: "https://agent.robinhood.com/mcp/trading",
    method: "POST",
    kind: "transport",
    proves: "whether the Streamable HTTP transport answers an MCP handshake from this origin",
  },
  {
    id: "protected-resource-metadata",
    url: "https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading",
    method: "GET",
    kind: "oauth-metadata",
    proves: "whether the RFC 9728 protected-resource document is served unauthenticated",
  },
  {
    id: "authorization-server-metadata",
    url: "https://agent.robinhood.com/.well-known/oauth-authorization-server",
    method: "GET",
    kind: "oauth-metadata",
    proves: "whether the RFC 8414 authorization-server document names grants, scopes and PKCE",
  },
];

/**
 * Fail-closed by construction: the `REACHABLE` branch is the only one reached by
 * a positive test, and every other input — including a status this code has never
 * seen — falls through to a refusal.
 */
export function classifyReachability(status: number | null | undefined): ReachabilityState {
  if (status === null || status === undefined || !Number.isFinite(status) || status <= 0) {
    return "UNREACHABLE";
  }
  if (status >= 200 && status < 300) return "REACHABLE";
  if (status === 403 || status === 451) return "JURISDICTION_BLOCKED";
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  return "REFUSED";
}

/**
 * `AUTHENTICATION_REQUIRED` is deliberately false here even though it is the most
 * encouraging refusal there is. A 401 proves the server exists and speaks OAuth;
 * it still yields no tool, no scope and no lifecycle, so a discovery packet
 * learns nothing from it that it could write down as a capability.
 */
export function discoveryIsPossible(state: ReachabilityState): boolean {
  return state === "REACHABLE";
}

export type ProbeObservation = {
  id: string;
  url: string;
  httpStatus: number | null;
  /** The venue's own words when it refused. Never paraphrased, never invented. */
  providerMessage: string | null;
  /**
   * An RFC 9728 `WWW-Authenticate` challenge, when one was sent.
   *
   * A challenge is a question the server asks, not an answer anybody gave it, so
   * capturing it carries no credential — and it is the one header that proves an
   * endpoint is a protected OAuth resource rather than merely a closed door.
   */
  challenge?: string | null;
  /** Standard OAuth metadata fields, for `oauth-metadata` targets that answered. */
  metadata?: Record<string, string | boolean | string[]> | null;
};

/** Ordered worst-first, so the summary reports the worst state that was seen. */
const SEVERITY: readonly ReachabilityState[] = [
  "UNREACHABLE",
  "JURISDICTION_BLOCKED",
  "REFUSED",
  "RATE_LIMITED",
  "AUTHENTICATION_REQUIRED",
  "REACHABLE",
];

export type ProbeVerdict = {
  state: ReachabilityState;
  discoveryPossible: boolean;
  observed: readonly (ProbeObservation & { state: ReachabilityState; sentence: string })[];
};

/**
 * One state for a set of observations, taken as the worst rather than the best.
 *
 * An empty set is `UNREACHABLE`, not `REACHABLE`: "nothing refused us" is what a
 * probe that never ran also reports, and those two must not be the same value.
 */
export function probeVerdict(observations: readonly ProbeObservation[]): ProbeVerdict {
  const observed = observations.map(function (observation) {
    const state = classifyReachability(observation.httpStatus);
    return { ...observation, state, sentence: summarizeProbe(observation) };
  });
  let worst: ReachabilityState = "REACHABLE";
  for (const entry of observed) {
    if (SEVERITY.indexOf(entry.state) < SEVERITY.indexOf(worst)) worst = entry.state;
  }
  const state = observed.length === 0 ? "UNREACHABLE" : worst;
  return { state, discoveryPossible: discoveryIsPossible(state), observed };
}

const MAX_MESSAGE = 240;

/** The venue's own sentence when it gave one; otherwise what this process can say. */
export function summarizeProbe(observation: ProbeObservation): string {
  const message = (observation.providerMessage ?? "").trim().slice(0, MAX_MESSAGE);
  if (message.length > 0) return message;
  const state = classifyReachability(observation.httpStatus);
  if (state === "UNREACHABLE") return "The endpoint did not answer.";
  if (state === "REACHABLE") return "The endpoint answered " + observation.httpStatus + ".";
  return "The endpoint returned HTTP " + observation.httpStatus + " with no message.";
}
