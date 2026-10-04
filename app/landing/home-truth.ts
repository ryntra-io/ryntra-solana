// The generated maturity map, not the full registry: this module runs in a
// client component, and importing ~900 lines of registry evidence to read one
// field pushed the landing past its bundle budget. Relative, with the
// extension, because node --test does not resolve the bundler's "@/" alias.
import { REGISTRY_MATURITY } from "../../lib/product/capability-maturity.ts";
import type { LandingPublicModel } from "@/lib/product/public-capability-view";

type LandingCapability = LandingPublicModel["capabilities"][number];

/**
 * The registry's own maturity per capability id. This is the only source a
 * public badge may read from: the runtime view proves the evidence is fresh,
 * it never decides what the maturity is.
 */
const REGISTRY_MATURITY_BY_ID: ReadonlyMap<string, LandingCapability["maturity"]> = new Map(
  Object.entries(REGISTRY_MATURITY) as [string, LandingCapability["maturity"]][],
);

/**
 * Fail-closed truth rules for the landing "works today" cards.
 *
 * Each card accepts the honest steady state of its registry capability:
 * Arcus spot and the RWA risk pack legitimately sit at `caution` because
 * public-user eligibility varies (the page discloses geo limits), and the
 * paper capabilities are `neutral` by nature. Anything outside the accepted
 * set — missing entry, non-fresh evidence, `danger`, or a wrong maturity —
 * downgrades the card instead of letting the claim overstate.
 */
export const HOME_CARD_RULES: Record<
  string,
  { maturity: readonly string[]; modes: readonly string[]; tones: readonly string[] }
> = {
  "arcus-spot-rfq": { maturity: ["live"], modes: ["supported_live"], tones: ["positive", "caution"] },
  "rwa-risk-pack": { maturity: ["live"], modes: ["read_only", "supported_live"], tones: ["positive", "caution"] },
  "smarttrade-plan": { maturity: ["live", "paper"], modes: ["paper_only", "supported_live"], tones: ["positive", "neutral"] },
  "decision-journal": { maturity: ["live", "paper"], modes: ["paper_only", "supported_live"], tones: ["positive", "neutral"] },
};

export function isHomeCardConfirmed(
  capabilityId: string,
  capability: LandingCapability | undefined,
): boolean {
  const rule = HOME_CARD_RULES[capabilityId];
  if (!rule || !capability) return false;
  if (!rule.maturity.includes(capability.maturity)) return false;
  if (!rule.modes.includes(capability.mode)) return false;
  if (capability.freshness !== "fresh") return false;
  if (!rule.tones.includes(capability.truthTone)) return false;
  return true;
}

/**
 * The maturity a public block is allowed to display, read from the registry
 * rather than written by hand.
 *
 * Hand-written badges drift: a block keeps saying "Live" long after the
 * capability behind it moved, and nobody notices until a user clicks into
 * nothing. Resolving the badge from the registry makes the overstated state
 * unreachable — the worst a stale block can do is under-promise.
 *
 * An unknown id or a missing registry entry returns `null`, and the caller
 * must then render the block as unverified instead of guessing.
 */
export function publicMaturity(
  capabilityId: string,
  capability: LandingCapability | undefined,
): LandingCapability["maturity"] | null {
  if (!capability) return null;
  if (capability.id !== capabilityId) return null;
  if (capability.freshness !== "fresh") return null;

  // The returned value comes from the registry, never from the argument.
  // Accepting the caller's maturity — even after checking that the id exists and
  // the value is a legal enum member — would still let a `planned` capability be
  // rendered as `live` by anything that constructed the object. Reading the
  // registry entry makes that unreachable rather than merely discouraged.
  const registered = REGISTRY_MATURITY_BY_ID.get(capabilityId);
  if (!registered) return null;

  // A disagreement between the runtime view and the registry is a conflict, not
  // a tie to break: fail closed and let the caller render "unverified".
  if (capability.maturity !== registered) return null;

  return registered;
}
