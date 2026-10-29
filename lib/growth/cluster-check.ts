import type { ClusterVerdict } from "../city-economy/honest-count.ts";
import { fundingLink, type PartyAncestry, PROTECT_RULES } from "./protect.ts";

/**
 * The one question the city asks the Growth line: were these two wallets one person?
 *
 * The city pays nothing of its own, but what it gives for a trade — points, a billboard, a district war's score, the
 * quarter host's part — is worth faking, and the cheapest fake is trading with yourself from a second wallet. The city
 * can see the obvious cases itself (the same wallet, the same signer). The rest lives here, because it needs the
 * chain, the devices and the links the protection run already reads: the Growth line answers, the city never sees a
 * hash, an address or a device.
 *
 * ## Three answers, and only one of them is a promise
 *
 * `same` says what was found and which finding said it. `separate` is the strong claim — every check ran on both
 * wallets and none of them matched — so it needs completeness, not merely silence. Everything else is `unknown`, and
 * the city counts nothing for an unknown pair. A check that could not be read is never the same thing as a check that
 * found nothing: that is the whole reason `unknown` exists.
 *
 * ## The order of the findings
 *
 * Any one finding is enough for `same`, so the order only decides which reason is reported. It runs from what the
 * person said themselves to what we inferred about them:
 *
 * 1. `linked_wallet` — they signed to say both wallets are theirs. Not an inference at all.
 * 2. `direct_funds` — one funded the other, or money moved between the two. A fact about this pair on the chain.
 * 3. `shared_withdrawal` — both paid out to the same address. An exchange's deposit address belongs to one person.
 * 4. `shared_device` — the same device hash. Strong, but a device can be shared by a household or an office.
 * 5. `shared_funder` — a common source that no reviewer marked as a hub. The weakest: a source can be popular before
 *    anyone marks it, which is why a marked hub drops out of `ancestors` upstream of this.
 *
 * The rules themselves are not this module's to invent: they are `PROTECT_RULES` of the protection run, and the
 * verdict carries their version so the city can say which rules judged a trade.
 */

/**
 * What the Growth line could see about two wallets at one moment. **A `null` field is a check that did not run** —
 * never a check that found nothing. Each side's set holds the party's own wallets, hashed the way the protection run
 * hashes them, so nothing raw travels with the evidence.
 */
export type ClusterEvidence = Readonly<{
  /** The funding trail of each side (`partyAncestry`), hashed. */
  funding: Readonly<{ left: PartyAncestry; right: PartyAncestry }> | null;
  /** Money moved between the two within `PROTECT_RULES.funding.directDays`. */
  moneyBetween: boolean | null;
  /** The hashed addresses each side paid out to. */
  withdrawals: Readonly<{ left: readonly string[]; right: readonly string[] }> | null;
  /** The hashed device and address signals each side was seen with. */
  devices: Readonly<{ left: readonly string[]; right: readonly string[] }> | null;
  /** Every wallet each side has signed for, its own included. */
  linked: Readonly<{ left: readonly string[]; right: readonly string[] }> | null;
}>;

/** Nothing was read: every pair is unknown, and the city counts nothing. */
export const NOTHING_READ: ClusterEvidence = Object.freeze({ funding: null, moneyBetween: null, withdrawals: null, devices: null, linked: null });

const meets = (left: readonly string[], right: readonly string[]): boolean => {
  const other = new Set(right);
  return left.some((value) => other.has(value));
};

/**
 * Why the answer is not `separate`, named by the first check that did not run — in the order a reader would ask.
 * `funding_incomplete` is its own code: the trail was read, but not far enough to stand behind «two people».
 */
function missing(evidence: ClusterEvidence): string | null {
  if (!evidence.linked) return "no_links";
  if (!evidence.funding) return "no_funding";
  if (!evidence.funding.left.complete || !evidence.funding.right.complete) return "funding_incomplete";
  if (evidence.funding.left.deep || evidence.funding.right.deep) return "funding_deep";
  if (evidence.moneyBetween === null) return "no_money_check";
  if (!evidence.withdrawals) return "no_withdrawals";
  if (!evidence.devices) return "no_devices";
  return null;
}

/**
 * The verdict on one pair. The two wallets are assumed to be different addresses — the city settles an identical pair
 * before it ever asks.
 */
export function clusterVerdict(evidence: ClusterEvidence): ClusterVerdict {
  const rules = PROTECT_RULES.version;

  if (evidence.linked && meets(evidence.linked.left, evidence.linked.right)) return { verdict: "same", reason: "linked_wallet", rules };

  const link = evidence.funding ? fundingLink(evidence.funding.left, evidence.funding.right) : null;
  if (link === "DIRECT" || evidence.moneyBetween === true) return { verdict: "same", reason: "direct_funds", rules };
  if (evidence.withdrawals && meets(evidence.withdrawals.left, evidence.withdrawals.right)) return { verdict: "same", reason: "shared_withdrawal", rules };
  if (evidence.devices && meets(evidence.devices.left, evidence.devices.right)) return { verdict: "same", reason: "shared_device", rules };
  if (link === "SHARED") return { verdict: "same", reason: "shared_funder", rules };

  const why = missing(evidence);
  return why === null ? { verdict: "separate", rules } : { verdict: "unknown", why };
}
