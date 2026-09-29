/* What the Binance account-scoped reads established (RYN-BIN-AOS-003).

   One conclusion dominates this module and it is not about balances.

   `tool_execute` takes the target tool's name as an *argument*:
   "Execute any visible tool. Equivalent to tools/call but with the tool name in arguments, for
   calling hidden tools in META mode." So a deny list keyed on MCP tool names does not constrain
   this server. Blocking `spot_newOrder` leaves the same operation reachable as
   `tool_execute({ toolName: "spot.newOrder", … })`, which is a different tool name and therefore
   not on the list.

   This repository built that guardrail twice — first from the provider's documented naming
   convention, then, after that failed, from the captured inventory — and both times the thing that
   actually prevented a write was a sentence in a prompt. The correct boundary on this surface is
   the OAuth scope granted at authorization and the provider's own confirmation step. Client-side
   tool filtering is defence in depth at best, and must never be described as a control. */

/** Permission flags whose `true` value enables a state-changing operation. */
export const WRITE_ENABLING_FLAGS = [
  "enableSpotAndMarginTrading",
  "enableFutures",
  "enableMargin",
  "permitsUniversalTransfer",
  "enableWithdrawals",
  "enableInternalTransfer",
  "enableVanillaOptions",
  "enablePortfolioMarginTrading",
  "enableFixApiTrade",
] as const;

export type PermissionFlags = Record<string, boolean>;

export type GrantedCapabilities = {
  reading: boolean;
  trading: boolean;
  transfer: boolean;
  withdrawal: boolean;
};

/**
 * Folds the raw permission envelope into the four questions that matter.
 *
 * This reports what the ENVELOPE says. It is not proof of what the agent's OAuth authorization
 * granted: `getApiKeyPermission` describes the account the session is bound to, and whether the
 * per-agent scope grant narrows it further was not established by any read in this packet. Naming
 * the function `grantedCapabilities` and meaning "the envelope permits" would be the kind of
 * quiet promotion this repository fails builds over — so the distinction lives in the type's
 * documentation and in the capability matrix, and the caller is expected to carry it.
 */
export function grantedCapabilities(flags: PermissionFlags): GrantedCapabilities {
  return {
    reading: flags.enableReading === true,
    trading:
      flags.enableSpotAndMarginTrading === true ||
      flags.enableFutures === true ||
      flags.enableMargin === true,
    transfer: flags.permitsUniversalTransfer === true || flags.enableInternalTransfer === true,
    withdrawal: flags.enableWithdrawals === true,
  };
}

/**
 * Whether a client-side tool blocklist is a sufficient control on this surface.
 *
 * Always false while `tool_execute` is reachable, which it is. The parameter exists so the answer
 * is derived from the condition rather than hard-coded, and so a future server that drops the
 * gateway changes the answer rather than the comment.
 */
export function clientBlocklistIsSufficient(context: { toolExecuteReachable: boolean }): boolean {
  return !context.toolExecuteReachable;
}
