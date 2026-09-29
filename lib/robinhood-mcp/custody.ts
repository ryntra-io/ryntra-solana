/* Robinhood surface custody (RYN-RH-MCP-001, read-only discovery).

   Recorded per SURFACE, for the same reason `lib/binance/capability.ts` records
   Binance per surface: Robinhood operates a custodial brokerage and a
   self-custody token at the same time. "Robinhood is custodial" is false about
   the Stock Token a holder keeps in their own wallet; "Robinhood is
   non-custodial" is false about the Agentic account it holds the cash in. A
   provider-level flag would have to be wrong about one of them.

   The axis this file exists for is `authorizationSurface`. It is `PROVIDER_NATIVE`
   and not `PROVIDER_CONFIRMATION`, and that single value is the difference
   between this surface and the Binance one. */

/** Who holds the assets on this surface. */
export type CustodyModel = "PROVIDER_CUSTODY" | "SELF_CUSTODY";

/** What actually authorizes a state change. */
export type AuthorizationSurface =
  /** A grant made once, at connection time, that the provider then honours per call. */
  | "PROVIDER_NATIVE"
  /** A human act inside the client, required for each action. */
  | "PROVIDER_CONFIRMATION"
  /** A signature from a key the holder controls. */
  | "WALLET_SIGNATURE";

/** The container the provider isolates the agent inside. */
export type ProviderBoundary =
  | "DEDICATED_AGENTIC_ACCOUNT"
  | "AGENTIC_SUBACCOUNT"
  | "NONE_HOLDER_WALLET";

/** Whether the agent can move assets off the surface entirely. */
export type WithdrawalCapability = "UNAVAILABLE_TO_AGENT" | "AVAILABLE_TO_AGENT" | "NOT_APPLICABLE";

/** Whether the agent can add assets to the surface. */
export type FundingCapability = "UNAVAILABLE_TO_AGENT" | "AVAILABLE_TO_AGENT" | "NOT_APPLICABLE";

/** Whether a person sees each order before it is placed. */
export type PerOrderHumanApproval =
  /** The client may be told to skip it, and the provider says so out loud. */
  | "OPTIONAL_CLIENT_SIDE"
  /** The provider itself will not act without it. */
  | "REQUIRED_BY_PROVIDER"
  /** There is nothing to approve. */
  | "NOT_APPLICABLE"
  /** Configured off. Used by the preflight evaluator, never by a surface record. */
  | "NONE";

/** How much the agent can see, which is a different question from how much it can do. */
export type ReadScope = "ALL_ROBINHOOD_ACCOUNTS" | "SINGLE_ACCOUNT" | "PUBLIC_ONLY" | "NOT_APPLICABLE";

/** How much the agent can change. */
export type WriteScope = "AGENTIC_ACCOUNT_ONLY" | "ALL_ACCOUNTS" | "NONE";

export type RobinhoodSurfaceCustody = {
  id: string;
  label: string;
  custodyModel: CustodyModel;
  authorizationSurface: AuthorizationSurface;
  providerBoundary: ProviderBoundary;
  withdrawalCapability: WithdrawalCapability;
  agentFundingCapability: FundingCapability;
  perOrderHumanApproval: PerOrderHumanApproval;
  readScope: ReadScope;
  writeScope: WriteScope;
  /** Why each axis reads the way it does, with the source that establishes it. */
  note: string;
  evidence: readonly string[];
};

/**
 * The Trading MCP surface.
 *
 * **`PROVIDER_NATIVE` is the load-bearing value.** Binance's Agentic sub-account
 * authorizes each action by a human confirming it inside the client, so the
 * confirmation *is* the authorization. Robinhood publishes the opposite
 * possibility in its own overview: *"if you've asked your agent to take action
 * without asking your approval, it can place trades without your confirmation."*
 * The May 2026 launch note softens it to *"When appropriate, agents will preview
 * orders with customers"* — `when appropriate`, decided by the client. So what
 * authorizes an order here is the OAuth grant made once at connection time, and
 * the per-order human step is an option the customer can switch off.
 *
 * That is the same asymmetry `RYN-AGENT-CONTROL-013` found in the MCP
 * specification — every human-in-the-loop control is a client `SHOULD` while
 * every hard control is a server `MUST` — except here the venue is a registered
 * broker-dealer and the object being created is a real order.
 *
 * **Read and write boundaries are different values on purpose.** The agent may
 * place trades only in the Agentic account, and it reads *all* Robinhood
 * accounts, account numbers, positions, balances, transactions, order history,
 * watchlists and scans. Collapsing the two into one "scope" is how a reader
 * concludes that a blast radius of one account is also a disclosure radius of
 * one account.
 */
export const ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT: RobinhoodSurfaceCustody = {
  id: "ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT",
  label: "Robinhood Trading MCP — dedicated Agentic account",
  custodyModel: "PROVIDER_CUSTODY",
  authorizationSurface: "PROVIDER_NATIVE",
  providerBoundary: "DEDICATED_AGENTIC_ACCOUNT",
  withdrawalCapability: "UNAVAILABLE_TO_AGENT",
  agentFundingCapability: "UNAVAILABLE_TO_AGENT",
  perOrderHumanApproval: "OPTIONAL_CLIENT_SIDE",
  readScope: "ALL_ROBINHOOD_ACCOUNTS",
  writeScope: "AGENTIC_ACCOUNT_ONLY",
  note:
    "Cash and positions sit in a Robinhood-held account — a self-directed individual investing " +
    "account of a distinct Agentic type, one of at most ten such accounts, opened only after a " +
    "primary individual account in good standing exists. Authorization is the grant made once " +
    "when the customer authenticates the agent, not a signature and not a per-order human act: " +
    "Robinhood's own overview states that if you have asked your agent to act without asking your " +
    "approval, it can place trades without your confirmation. The customer funds the account " +
    "themselves and the agent has no documented tool that deposits, withdraws or transfers, so " +
    "the blast radius is exactly the funded balance. Crypto is tradable and explicitly not " +
    "transferable, stakeable or lendable by the agent. Reads span every Robinhood account the " +
    "customer holds, including account numbers, while writes are confined to the Agentic account.",
  evidence: [
    "docs: robinhood.com/us/en/support/articles/agentic-trading-overview (2026-08-24, Reference No. 5847370)",
    "docs: robinhood.com/us/en/support/articles/trading-with-your-agent (2026-08-24, Reference No. 5847437)",
    "docs: robinhood.com/us/en/agentic-trading (2026-08-24)",
    "fixture: lib/robinhood-mcp/fixtures/documented-tools.json",
  ],
};

/**
 * The second Robinhood surface, and the reason custody is recorded per surface.
 *
 * A Robinhood Stock Token on Robinhood Chain is held by whoever holds the key.
 * Three of the axes invert. It is recorded here — not implemented here — so that
 * the moment anything is drawn about both surfaces at once, the two rows disagree
 * on the page instead of collapsing into one wrong sentence. The Stock Token
 * adapter itself is `RYN-RHC-001` and lives in `lib/rwa/rhj/`.
 */
export const ROBINHOOD_CHAIN_STOCK_TOKEN: RobinhoodSurfaceCustody = {
  id: "ROBINHOOD_CHAIN_STOCK_TOKEN",
  label: "Robinhood Chain — Stock Token (RHJ)",
  custodyModel: "SELF_CUSTODY",
  authorizationSurface: "WALLET_SIGNATURE",
  providerBoundary: "NONE_HOLDER_WALLET",
  withdrawalCapability: "NOT_APPLICABLE",
  agentFundingCapability: "NOT_APPLICABLE",
  perOrderHumanApproval: "NOT_APPLICABLE",
  readScope: "PUBLIC_ONLY",
  writeScope: "NONE",
  note:
    "A token held in the holder's own wallet on Robinhood Chain, moved by a signature from a key " +
    "Robinhood does not hold. There is no account to withdraw from and no agent to fund, so both " +
    "movement axes are not applicable rather than unavailable — a different fact from the Agentic " +
    "account, where an account exists and the agent may not move value out of it. Ryntra reads " +
    "this surface through the public Stock Token API only, and that read is itself refused from " +
    "this egress. No write path exists in this product.",
  evidence: [
    "repo: lib/rwa/rhj/client.ts (RYN-RHC-001)",
    "fixture: lib/robinhood-mcp/fixtures/reachability-probe.json",
  ],
};

/** Both surfaces, together, so a reader cannot find one without the other. */
export const ROBINHOOD_SURFACE_CUSTODY: readonly RobinhoodSurfaceCustody[] = [
  ROBINHOOD_TRADING_MCP_AGENTIC_ACCOUNT,
  ROBINHOOD_CHAIN_STOCK_TOKEN,
];

/** Copy that is true on a self-custody surface and false on a provider-custody one. */
export const FORBIDDEN_ROBINHOOD_SURFACE_CLAIMS: readonly string[] = [
  "Your keys never leave your wallet",
  "Non-custodial",
  "You hold the keys",
  "Self-custody",
  "Your funds never touch a third party",
];

/** Throws rather than warns. A claim gate that can be ignored is not a gate. */
export function assertClaimAllowed(surface: RobinhoodSurfaceCustody, claim: string): void {
  if (surface.custodyModel !== "PROVIDER_CUSTODY") return;
  const haystack = claim.toLowerCase();
  for (const forbidden of FORBIDDEN_ROBINHOOD_SURFACE_CLAIMS) {
    if (haystack.includes(forbidden.toLowerCase())) {
      throw new Error(
        `"${claim}" asserts self-custody on ${surface.id}, which is a provider custody surface.`,
      );
    }
  }
}
