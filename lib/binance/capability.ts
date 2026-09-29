/* Binance MCP capability register (RYN-BIN-AOS-001, read-only discovery).

   Two things this file exists to prevent.

   First, a single custodial flag on the provider. Binance operates at least two surfaces with
   opposite custody properties — an Agentic sub-account whose funds Binance holds, and a payment
   facilitator path where the payer signs from their own wallet. "Binance is custodial" would be
   false about one of them and "Binance is non-custodial" false about the other, so custody is
   recorded per SURFACE across four independent axes.

   Second, a discovery packet quietly promoting itself into a shipped capability. Nothing here is
   implemented against. The `ryntra` axis is `planned` for everything read-only and `blocked` for
   every write, and the test suite fails the build if any record claims otherwise. */

import type { CapabilityState } from "../domain/capability.ts";

/** Who holds the assets on this surface. */
export type CustodyModel = "PROVIDER_CUSTODY" | "SELF_CUSTODY";

/** What actually authorizes a state change. */
export type AuthorizationSurface = "PROVIDER_CONFIRMATION" | "WALLET_SIGNATURE";

/** The container the provider isolates the agent inside. */
export type ProviderBoundary = "AGENTIC_SUBACCOUNT" | "NONCUSTODIAL_FACILITATOR";

/** Whether the agent can move funds off the surface entirely. */
export type WithdrawalCapability = "UNAVAILABLE_TO_AGENT" | "AVAILABLE_TO_AGENT" | "NOT_APPLICABLE";

export type BinanceSurfaceCustody = {
  id: string;
  label: string;
  custodyModel: CustodyModel;
  authorizationSurface: AuthorizationSurface;
  providerBoundary: ProviderBoundary;
  withdrawalCapability: WithdrawalCapability;
  /** Why each axis reads the way it does, with the source that establishes it. */
  note: string;
  evidence: readonly string[];
};

export const BINANCE_MCP_AGENTIC_ACCOUNT: BinanceSurfaceCustody = {
  id: "BINANCE_MCP_AGENTIC_ACCOUNT",
  label: "Binance MCP Server — Agentic sub-account",
  custodyModel: "PROVIDER_CUSTODY",
  authorizationSurface: "PROVIDER_CONFIRMATION",
  providerBoundary: "AGENTIC_SUBACCOUNT",
  withdrawalCapability: "UNAVAILABLE_TO_AGENT",
  note:
    "Funds sit in a Binance-held sub-account of the user's own Binance account, shown in the Binance UI as " +
    "an 'Agentic virtual sub'. Nothing is signed by a user key: the agent restates the action and the human " +
    "confirms it inside the client, which is a confirmation, not a signature. Binance's documentation states " +
    "there is no withdrawal scope and that the agent can never move funds to an external address. The first " +
    "deposit into the sub-account is a manual human transfer in the Binance web UI; the Transfer scope only " +
    "moves funds between wallets inside the same sub-account.",
  evidence: [
    "docs: developers.binance.com/en/docs/agent-native/mcp-server/agentic (2026-08-23)",
    "fixture: lib/binance/fixtures/mcp-discovery.json → mcpInitialize.result.instructions",
  ],
};

/**
 * The second Binance surface, and the reason this file records custody per surface rather than
 * per provider.
 *
 * B402 is Binance's implementation of the x402 payment protocol on BNB Smart Chain, and its
 * custody axes are the **opposite** of the Agentic sub-account's on three of four. The buyer signs
 * an EIP-712 authorization from their own wallet; Binance's own documentation states that B402
 * "does not take possession, custody, or control of user funds", that assets "move directly
 * on-chain between addresses designated by the user and the merchant", and that its role is
 * limited to signature verification and transaction submission. That is a non-custodial
 * facilitator, and calling it provider custody because the word Binance appears would be as wrong
 * as the reverse.
 *
 * Withdrawal is `NOT_APPLICABLE` rather than unavailable: there is no account to withdraw from.
 * The buyer's funds are in the buyer's own wallet the whole time, and the only movement the
 * protocol performs is the transfer the buyer signed for.
 *
 * **This is not an integration.** Ryntra holds no `clientId`, no RSA key and no allowlisted source
 * IP for the authenticated `/papi/v2/b402/*` surface, and requests none. The record exists so that
 * a surface's custody can be stated correctly the moment anything is drawn about it.
 */
export const BINANCE_B402_FACILITATOR: BinanceSurfaceCustody = {
  id: "BINANCE_B402_FACILITATOR",
  label: "Binance B402 — x402 payment facilitator",
  custodyModel: "SELF_CUSTODY",
  authorizationSurface: "WALLET_SIGNATURE",
  providerBoundary: "NONCUSTODIAL_FACILITATOR",
  withdrawalCapability: "NOT_APPLICABLE",
  note:
    "The buyer signs an EIP-712 payment authorization off-chain from their own wallet and never " +
    "deposits anything. Binance verifies the signature, sponsors the gas and submits the transfer, " +
    "which moves peer-to-peer from the buyer's address to the merchant's. Binance's own " +
    "documentation disclaims possession, custody and control of the funds and describes the role " +
    "as message validation, signature verification and transaction submission. There is no account " +
    "on this surface, so there is nothing to withdraw from — which is a different fact from the " +
    "Agentic sub-account, where an account exists and the agent may not withdraw from it. " +
    "Production access requires merchant onboarding that has not happened and is not requested.",
  evidence: [
    "docs: developers.binance.com/docs/onchainpay-x402/introduction (2026-08-24)",
    "docs: developers.binance.com/docs/onchainpay-x402/basics/4.base-urls (2026-08-24)",
  ],
};

/**
 * Both surfaces, together, so that a reader cannot find one without the other.
 *
 * A list of one is how the provider-level flag comes back: whoever adds the third surface will
 * see two rows that disagree on three axes and will know the answer is per surface.
 */
export const BINANCE_SURFACE_CUSTODY: readonly BinanceSurfaceCustody[] = [
  BINANCE_MCP_AGENTIC_ACCOUNT,
  BINANCE_B402_FACILITATOR,
];

/**
 * Copy that would be true on a self-custody surface and is false on this one. A shipped sentence
 * that outlives its boundary is the failure this repository has already paid for once.
 */
export const FORBIDDEN_BINANCE_SURFACE_CLAIMS: readonly string[] = [
  "Your keys never leave your wallet",
  "Non-custodial",
  "You hold the keys",
  "Self-custody",
  "Your funds never touch a third party",
];

/**
 * Refuses self-custody copy on a provider-custody surface. Throwing rather than warning, because
 * a claim gate that can be ignored is not a gate.
 */
export function assertClaimAllowed(surface: BinanceSurfaceCustody, claim: string): void {
  if (surface.custodyModel !== "PROVIDER_CUSTODY") return;
  const haystack = claim.toLowerCase();
  for (const forbidden of FORBIDDEN_BINANCE_SURFACE_CLAIMS) {
    if (haystack.includes(forbidden.toLowerCase())) {
      throw new Error(
        `"${claim}" asserts self-custody on ${surface.id}, which is a provider custody surface.`,
      );
    }
  }
}

/** The four scopes Binance's documentation names, plus `none` for the unscoped handshake. */
export type BinanceMcpScope = "none" | "market-data" | "account" | "trade" | "transfer";

export type BinanceMcpCapability = {
  id: string;
  title: string;
  scope: BinanceMcpScope;
  state: CapabilityState;
  /** True when this capability was exercised over the MCP transport, with or without credentials. */
  reachedOverMcp: boolean;
  /**
   * True only when it was reached with NO credentials. The distinction matters: the handshake is
   * open to anyone, the tool inventory needed the founder's authorization, and conflating the two
   * would make an owner-gated fact look like a public one.
   */
  reachedWithoutCredentials: boolean;
  evidence: readonly string[];
};

const DISCOVERED = "2026-08-23";
/** Same day, but a separate constant: this is the authorized verification, not the open probe. */
const VERIFIED = "2026-08-23";

/** Reached unauthenticated over MCP, so `live-probe` is literally what happened. */
const PROBED: CapabilityState = {
  protocol: "live",
  ryntra: "planned",
  user: "available",
  verifiedAt: DISCOVERED,
  source: "live-probe",
  reason: "Reached over the MCP transport without credentials during read-only discovery.",
};

/** Documented by the provider and gated behind an authorization this packet did not perform. */
const DOCUMENTED_READ: CapabilityState = {
  protocol: "live",
  ryntra: "planned",
  user: "unknown",
  verifiedAt: DISCOVERED,
  source: "official-docs",
  reason: "Behind OAuth; tools/list returned 401 unauthenticated, so the tool was never invoked.",
};

/**
 * Reached over MCP **with** the founder's authorization in `RYN-BIN-AOS-002`. `user: available`
 * because this account demonstrably could do it; `ryntra: planned` because Ryntra still ships
 * nothing against it.
 */
const PROBED_AUTHORIZED: CapabilityState = {
  protocol: "live",
  ryntra: "planned",
  user: "available",
  verifiedAt: VERIFIED,
  source: "live-probe",
  reason: "Read over MCP under the founder-authorized connection; no account-scoped tool was called.",
};

/**
 * An account-scoped read actually performed in `RYN-BIN-AOS-003`, under the founder's instruction.
 * The distinction from `PROBED_AUTHORIZED` is that a tool carrying the `account` scope was called.
 */
const PROBED_ACCOUNT: CapabilityState = {
  protocol: "live",
  ryntra: "planned",
  user: "available",
  verifiedAt: VERIFIED,
  source: "live-probe",
  reason: "Account-scoped read performed and returned data; no write of any kind was attempted.",
};

/**
 * A write capability this line of packets deliberately excludes.
 *
 * `user` stays `unknown` on purpose. `wallet.getApiKeyPermission` reports the account's envelope
 * with spot/margin trading, futures and universal transfer ENABLED — but that endpoint describes
 * the account the session is bound to, not necessarily the scope granted to this agent, and no
 * write was attempted to settle which. Promoting `user` to `available` on the strength of an
 * envelope read would be exactly the unverified promotion this register exists to prevent.
 */
const DOCUMENTED_WRITE: CapabilityState = {
  protocol: "live",
  ryntra: "blocked",
  user: "unknown",
  verifiedAt: VERIFIED,
  source: "official-docs",
  reason:
    "Out of scope; a write path requires its own owner-gated packet. The permission envelope read " +
    "on 2026-08-23 reports this family as enabled, which is an envelope fact, not a verified " +
    "OAuth grant — see docs/binance/CAPABILITY-MATRIX.md.",
};

const DOC = "docs: developers.binance.com/en/docs/agent-native/mcp-server/agentic (2026-08-23)";
const INIT_FIXTURE = "fixture: lib/binance/fixtures/mcp-discovery.json → mcpInitialize";
const UNAUTH_FIXTURE = "fixture: lib/binance/fixtures/mcp-discovery.json → mcpToolsListUnauthenticated";
const ACCOUNT_FIXTURE = "fixture: lib/binance/fixtures/account-scope.json (RYN-BIN-AOS-003)";
const INVENTORY_FIXTURE = "fixture: lib/binance/fixtures/tool-inventory.json (RYN-BIN-AOS-002)";

export const BINANCE_MCP_CAPABILITIES: readonly BinanceMcpCapability[] = [
  {
    id: "MCP_INITIALIZE",
    title: "MCP handshake over Streamable HTTP",
    scope: "none",
    state: PROBED,
    reachedOverMcp: true,
    reachedWithoutCredentials: true,
    evidence: [INIT_FIXTURE, DOC],
  },
  {
    id: "MCP_SERVER_INSTRUCTIONS",
    title: "Server-published tool-naming convention, product list and constraints",
    scope: "none",
    state: PROBED,
    reachedOverMcp: true,
    reachedWithoutCredentials: true,
    evidence: [INIT_FIXTURE],
  },
  {
    id: "MCP_OAUTH_AUTHORIZATION",
    title: "Authorization-code + PKCE OAuth against accounts.binance.com",
    scope: "none",
    state: DOCUMENTED_READ,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [
      "fixture: lib/binance/fixtures/mcp-discovery.json → oauthAuthorizationServer",
      "fixture: lib/binance/fixtures/mcp-discovery.json → oauthProtectedResource",
      DOC,
    ],
  },
  {
    id: "MCP_TOOL_INVENTORY",
    title: "The callable tool set — 81 directly visible, 316 in the registry",
    scope: "none",
    state: PROBED_AUTHORIZED,
    reachedOverMcp: true,
    reachedWithoutCredentials: false,
    evidence: [UNAUTH_FIXTURE, INVENTORY_FIXTURE],
  },
  {
    id: "MCP_TOOL_SEARCH",
    title: "tool_search — paginated search over the server's own tool registry by category",
    scope: "none",
    state: PROBED_AUTHORIZED,
    reachedOverMcp: true,
    reachedWithoutCredentials: false,
    evidence: [
      INVENTORY_FIXTURE,
      "The only Binance tool this packet invoked. Its 17 categories come from its own schema enum.",
    ],
  },
  {
    id: "MCP_RESOURCE_INVENTORY",
    title: "resources/list — one published workflow, not a catalogue",
    scope: "none",
    state: PROBED_AUTHORIZED,
    reachedOverMcp: true,
    reachedWithoutCredentials: false,
    evidence: [
      "fixture: lib/binance/fixtures/mcp-discovery.json → mcpResourcesListUnauthenticated",
      INIT_FIXTURE,
    ],
  },
  {
    id: "MCP_MARKET_DATA",
    title: "Tickers, order books, candlesticks and funding rates",
    scope: "market-data",
    state: DOCUMENTED_READ,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [
      DOC,
      "fixture: lib/binance/fixtures/market-data.json (REST-verified equivalents, MCP-unverified)",
    ],
  },
  {
    id: "MCP_ACCOUNT_READ",
    title: "Agentic sub-account balances — read, and empty across all ten wallets",
    scope: "account",
    state: PROBED_ACCOUNT,
    reachedOverMcp: true,
    reachedWithoutCredentials: false,
    evidence: [DOC, ACCOUNT_FIXTURE],
  },
  {
    id: "MCP_MAIN_ACCOUNT_READONLY_VIEW",
    title: "Read-only view of the master account — confirmed working",
    scope: "account",
    state: PROBED_ACCOUNT,
    reachedOverMcp: true,
    reachedWithoutCredentials: false,
    evidence: [DOC, ACCOUNT_FIXTURE],
  },
  {
    id: "MCP_TRADE_SPOT",
    title: "Spot order placement and cancellation",
    scope: "trade",
    state: DOCUMENTED_WRITE,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [DOC, INIT_FIXTURE],
  },
  {
    id: "MCP_TRADE_MARGIN",
    title: "Margin order placement and cancellation",
    scope: "trade",
    state: DOCUMENTED_WRITE,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [DOC, INIT_FIXTURE],
  },
  {
    id: "MCP_TRADE_CONVERT",
    title: "Convert quote request and quote acceptance",
    scope: "trade",
    state: DOCUMENTED_WRITE,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [DOC, INIT_FIXTURE],
  },
  {
    id: "MCP_TRADE_USDM_FUTURES",
    title: "USDⓈ-M futures orders, leverage and margin type",
    scope: "trade",
    state: DOCUMENTED_WRITE,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [DOC, INIT_FIXTURE],
  },
  {
    id: "MCP_TRADE_COINM_FUTURES",
    title: "COIN-M futures orders, leverage and margin type",
    scope: "trade",
    state: DOCUMENTED_WRITE,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [DOC, INIT_FIXTURE],
  },
  {
    id: "MCP_TRADE_TOKENIZED_EQUITY",
    title: "Tokenized-stock (bstock) trading — no tool of its own; routed through the Spot tools",
    scope: "trade",
    state: {
      ...DOCUMENTED_WRITE,
      verifiedAt: VERIFIED,
      reason:
        "The registry contains zero tools matching /equity|stock/: the 16 published " +
        "/sapi/v1/equity/* endpoints are not exposed. The server's instructions say to route stock " +
        "trades through the Spot tools, so whether a tokenized stock is reachable at all is a " +
        "property of the Spot symbol set and was not established here.",
    },
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [
      INIT_FIXTURE,
      INVENTORY_FIXTURE,
      "docs: developers.binance.com/en/docs/products/stocks/introduction (2026-08-23)",
    ],
  },
  {
    id: "MCP_INTERNAL_TRANSFER",
    title: "Transfers between wallets inside the same Agentic sub-account",
    scope: "transfer",
    state: DOCUMENTED_WRITE,
    reachedOverMcp: false,
    reachedWithoutCredentials: false,
    evidence: [DOC, INIT_FIXTURE],
  },
];

export function capabilityById(id: string): BinanceMcpCapability {
  const found = BINANCE_MCP_CAPABILITIES.find((capability) => capability.id === id);
  if (!found) throw new Error(`Unknown capability: ${id}`);
  return found;
}
