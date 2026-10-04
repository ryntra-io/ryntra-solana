/* Where a control physically runs (read-only discovery).

   This module exists because of one sentence Robinhood publishes about its own
   product: *"By creating an Agentic Account, you authorize third-party AI agents
   to view your account data and execute trades on your behalf. Robinhood does not
   control, supervise, monitor, recommend, or audit these AI agents."*

   The customer's agent talks to `agent.robinhood.com` directly. Ryntra is not on
   that wire. Whatever Ryntra draws about such an account — a risk panel, a limit,
   a policy, an alert — is a **description of something that already happened**,
   not a gate the order passed through. Calling that "enforced" would be the
   single most expensive claim this product could make, because a reader would
   reasonably conclude that turning a Ryntra limit on would stop an order, and it
   would not.

   So enforcement is a function of topology and of nothing else. It cannot be set,
   configured, upgraded by a maturity flag or promised by copy: it is derived from
   where the bytes go. */

/** How an agent's request physically reaches the venue. */
export type ControlPathTopology =
  /** The request is constructed and released by a Ryntra adapter. Ryntra can refuse it. */
  | "AGENT_THROUGH_RYNTRA_ADAPTER"
  /** The customer's own MCP client speaks to the provider. Ryntra sees the result, not the request. */
  | "AGENT_DIRECT_TO_PROVIDER"
  /** No path exists at all. This is what Ryntra has today on this surface. */
  | "NO_PATH";

/** What Ryntra may honestly claim about a control on that path. */
export type RyntraEnforcementMode = "ENFORCED_THROUGH_RYNTRA" | "OBSERVED_EXTERNALLY";

/** Verbs an observing product may use. Every one of them happens after the fact. */
export const OBSERVED_EXTERNALLY_CAPABILITIES = ["observe", "import", "reconcile", "alert"] as const;

/** Verbs that additionally become available when the request itself passes through. */
export const ENFORCED_THROUGH_RYNTRA_CAPABILITIES = [
  "observe",
  "import",
  "reconcile",
  "alert",
  "preflight",
  "refuse",
] as const;

export type EnforcementCapability =
  | (typeof OBSERVED_EXTERNALLY_CAPABILITIES)[number]
  | (typeof ENFORCED_THROUGH_RYNTRA_CAPABILITIES)[number];

/**
 * The only way a mode is produced. There is deliberately no setter, no override
 * and no configuration flag: a topology is a fact about deployment, and a mode
 * that could be typed in by hand would be a claim.
 */
export function enforcementModeFor(topology: ControlPathTopology): RyntraEnforcementMode {
  return topology === "AGENT_THROUGH_RYNTRA_ADAPTER" ? "ENFORCED_THROUGH_RYNTRA" : "OBSERVED_EXTERNALLY";
}

export function capabilitiesFor(mode: RyntraEnforcementMode): readonly EnforcementCapability[] {
  return mode === "ENFORCED_THROUGH_RYNTRA"
    ? ENFORCED_THROUGH_RYNTRA_CAPABILITIES
    : OBSERVED_EXTERNALLY_CAPABILITIES;
}

/**
 * Throws when a claim of enforcement is made about a path that does not run
 * through Ryntra. Understating is always permitted — an enforced path described
 * as merely observed costs the product a feature, not a reader their money.
 */
export function assertEnforcementClaim(
  claimed: RyntraEnforcementMode,
  topology: ControlPathTopology,
): void {
  if (claimed !== "ENFORCED_THROUGH_RYNTRA") return;
  if (topology === "AGENT_THROUGH_RYNTRA_ADAPTER") return;
  throw new Error(
    "ENFORCED_THROUGH_RYNTRA claimed on topology " + topology +
      ": the request does not pass through a Ryntra adapter, so nothing here can refuse it. " +
      "The honest mode is OBSERVED_EXTERNALLY (" + OBSERVED_EXTERNALLY_CAPABILITIES.join(", ") + ").",
  );
}

/**
 * Ryntra's actual topology on the Robinhood Trading MCP today.
 *
 * `NO_PATH`, not `AGENT_DIRECT_TO_PROVIDER`: there is no Ryntra adapter, and
 * there is also no imported Robinhood brokerage account anywhere in this product
 * to observe. The distinction matters for any next step — moving to
 * `AGENT_DIRECT_TO_PROVIDER` is an import feature and changes no enforcement
 * claim, while moving to `AGENT_THROUGH_RYNTRA_ADAPTER` would be a different
 * product with a credential in it.
 */
export const RYNTRA_ROBINHOOD_MCP_TOPOLOGY: ControlPathTopology = "NO_PATH";

/** The mode every record in this package carries, derived rather than written. */
export const RYNTRA_ROBINHOOD_MCP_ENFORCEMENT: RyntraEnforcementMode =
  enforcementModeFor(RYNTRA_ROBINHOOD_MCP_TOPOLOGY);
