/**
 * Mainnet promotion, one capability at a time, on that capability's own canary.
 *
 * The product's second finish condition is stated as prose: *mainnet, not
 * testnet — and every capability earned its own canary. No maturity is
 * inherited because the chain opened.* This module is that sentence with a
 * return value.
 *
 * **The failure it exists to prevent is inheritance.** A network goes live, a
 * transfer settles, somebody reads that as "we are on mainnet", and six
 * capabilities that never ran there are described as if they had. It is the
 * cheapest possible mistake to make and the most expensive one to discover,
 * because by the time it is visible the claim is already published. So the only
 * thing that can promote a capability is a canary naming *that* capability, on
 * *that* capability's mainnet, observed by something other than the path that
 * submitted it, reconciled, unexpired, and with an owner decision attached.
 *
 * **Today it promotes nothing, and that is computed rather than written.**
 * Since 2026-08-21 Base Sepolia is the default execution rail for this phase,
 * testnet only, no mainnet execution. `AGENT_CONTROL_CANARIES` is therefore
 * empty and every capability answers `BLOCKED` / `NO_CANARY`. When that
 * changes it changes by a record being added here, not by a paragraph being
 * edited somewhere else.
 *
 * The gate is deliberately capable of saying yes. A promotion gate that can
 * never open is a wall with a test attached, and the suite proves the open path
 * as carefully as it proves the closed ones.
 *
 * This module declares its own capability ids and does not import the product
 * capability registry: `lib/agent-control/` has no dependency on `lib/product/`
 * and gains none here. The join between the two lives on the product side, in
 * `lib/product/agent-control-surfaces.ts`.
 */

export const CANARY_VALIDITY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAINNET_PROMOTION_REFUSALS = Object.freeze([
  /** No canary names this capability at all. The default, and the current answer. */
  "NO_CANARY",
  /** A canary exists but ran on a chain that is not this capability's mainnet. */
  "CANARY_NETWORK_MISMATCH",
  /** Nothing other than the submitting path saw the effect. */
  "CANARY_NOT_INDEPENDENTLY_OBSERVED",
  /** Authorized and actual were never compared, or did not match. */
  "CANARY_NOT_RECONCILED",
  /** Observed too long ago, or dated in the future. */
  "CANARY_EXPIRED",
  /** No owner said to promote, or said it without identity or policy version. */
  "OWNER_DECISION_MISSING",
] as const);

export type MainnetPromotionRefusal = (typeof MAINNET_PROMOTION_REFUSALS)[number];

/**
 * A capability that could, one day, be promoted to a mainnet — and the exact
 * record that would open it.
 *
 * The set is the *economic* lifecycle rather than the public capability rows,
 * because "mainnet, not testnet" is a statement about moving and proving value.
 * A public read of a registry does not become more true on a mainnet.
 */
export type PromotableCapability = Readonly<{
  id: string;
  label: string;
  /** One line: what promoting this would let the product actually do. */
  what: string;
  /** The module that owns the behaviour, so a reader can go and look. */
  module: string;
  /** CAIP-2 reference of the mainnet this capability would run on. */
  mainnetChainRef: string;
  /** The named record whose existence would make a promotion possible. */
  opensWith: string;
}>;

/**
 * Two chains appear here and the difference matters: a capability's mainnet is
 * a property of the capability, so a canary on Base does not promote something
 * whose rail is Solana. Base mainnet is `eip155:8453`; Solana mainnet-beta is
 * identified by its genesis hash under CAIP-2.
 */
const BASE_MAINNET = "eip155:8453";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const PROMOTABLE_CAPABILITIES: readonly PromotableCapability[] = Object.freeze([
  Object.freeze({
    id: "action-execution",
    label: "Action execution",
    what: "Submit an authorized action to a mainnet rather than observing one somebody else submitted.",
    module: "lib/agent-control/adapters/base-evm.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "A decision that replaces the testnet-only rule, plus an execution adapter: today the adapter entry is READ_ONLY and the mainnet chain id is deliberately absent from BASE_SEPOLIA_CAIP2.",
  }),
  Object.freeze({
    id: "settlement-observation",
    label: "Independent settlement observation",
    what: "Read a mainnet effect back through a path that did not submit it.",
    module: "lib/agent-control/adapters/base-evm.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "A configured mainnet read source that is not the submitting client, recorded with its endpoint class and its own freshness, so an observation cannot be the submitter agreeing with itself.",
  }),
  Object.freeze({
    id: "reconciliation",
    label: "Mainnet reconciliation",
    what: "Compare what was authorized against what actually happened on a mainnet.",
    module: "lib/agent-control/reconcile.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "An observed mainnet outcome to reconcile against: the reconciler is complete and rail-neutral, and what is missing is an effect it has never been handed.",
  }),
  Object.freeze({
    id: "outcome-receipt",
    label: "Outcome Receipt over a mainnet effect",
    what: "Issue the third public artifact over an effect that happened on a mainnet.",
    module: "lib/agent-control/artifacts.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "A finalized mainnet outcome plus an issuer attestation: a preview that states OUTCOME_NOT_OBSERVED is a preview, and calling it a receipt would claim an outcome nobody observed.",
  }),
  Object.freeze({
    id: "x402-service-payment",
    label: "x402 service payment",
    what: "Settle a service payment through the 402 engine on a mainnet.",
    module: "lib/agent-control/payments/x402-engine.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "A facilitator credential and an owner asset policy for the target chain: nine of the candidate routes are declarable and none is reachable, because Ryntra holds no facilitator credential and no signer.",
  }),
  Object.freeze({
    id: "job-commerce",
    label: "ERC-8183 job commerce",
    what: "Accept, fund and settle a job on a mainnet through the commerce adapters.",
    module: "lib/agent-control/payments/draft-standards.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "A finalized standard rather than a Draft, plus a deployed address the registry may pin: the mirrors carry a content digest and deliberately carry no ABI and no address.",
  }),
  Object.freeze({
    id: "bounded-mandate",
    label: "Bounded mandate on a mainnet",
    what: "Hold an explicit, revocable technical authority that a mainnet actually enforces.",
    module: "lib/agent-control/owner-control.ts",
    mainnetChainRef: BASE_MAINNET,
    opensWith:
      "A real enforcement grade from a provider that can bind and revoke it: without one, resolveOwnerAuthority fails closed to PER_ACTION and OBSERVE_ONLY, which is the correct answer rather than a limitation.",
  }),
  Object.freeze({
    id: "solana-action",
    label: "Solana action on mainnet-beta",
    what: "Run the Token-2022 action path against mainnet-beta rather than devnet.",
    module: "lib/agent-control/adapters/solana-token-2022.ts",
    mainnetChainRef: SOLANA_MAINNET,
    opensWith:
      "A Solana mainnet canary of its own: the ecosystem's owner-signed mainnet Send canary is a separate record, and Agent Control has no executed Solana action or Receipt at all. An ecosystem canary would not promote this row by itself — the Agent Control identity has to be bound to the action.",
  }),
]);

const BY_ID = new Map(PROMOTABLE_CAPABILITIES.map((entry) => [entry.id, entry]));

export function promotableCapability(id: string): PromotableCapability {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown promotable capability: ${id}`);
  return entry;
}

/** What an independent read-back has to carry before it counts as one. */
export type CanaryObservation = Readonly<{ source: string; reference: string }>;

export type CanaryOwnerDecision = Readonly<{
  decision: string;
  decidedBy: string;
  policyVersion: string;
}>;

export type MainnetCanary = Readonly<{
  capability: string;
  /** CAIP-2 reference of the chain the canary actually ran on. */
  network: string;
  submittedAt: string;
  observedAt: string;
  independentObservation: CanaryObservation | null;
  reconciliation: string;
  ownerDecision: CanaryOwnerDecision | null;
}>;

/**
 * The canaries this product actually has.
 *
 * Empty, and empty on purpose. Base Sepolia is the only rail this phase and
 * Base mainnet is closed, so there is no mainnet run to record. Every surface
 * that wants to state Agent Control's mainnet maturity reads this and gets the
 * same answer.
 */
export const AGENT_CONTROL_CANARIES: readonly MainnetCanary[] = Object.freeze([]);

export type PromotionVerdict = Readonly<{
  capability: string;
  label: string;
  mainnetChainRef: string;
  state: "PROMOTABLE" | "BLOCKED";
  refusals: readonly MainnetPromotionRefusal[];
  /** The canary that carried the verdict, when one did. */
  evidence: MainnetCanary | null;
  opensWith: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function instantMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Every reason this one canary fails to promote this one capability, in the
 * declared order.
 *
 * All of them, not the first: a canary wrong in four ways reported as wrong in
 * one is how a fix lands, the gate still refuses, and the next person concludes
 * the gate is broken.
 */
function refusalsFor(
  capability: PromotableCapability,
  candidate: unknown,
  asOfMs: number,
): readonly MainnetPromotionRefusal[] {
  const refusals: MainnetPromotionRefusal[] = [];
  if (!isRecord(candidate)) return ["NO_CANARY"];

  if (candidate.network !== capability.mainnetChainRef) refusals.push("CANARY_NETWORK_MISMATCH");

  const observation = candidate.independentObservation;
  if (
    !isRecord(observation)
    || typeof observation.source !== "string"
    || observation.source.trim().length === 0
    || typeof observation.reference !== "string"
    || observation.reference.trim().length === 0
  ) {
    refusals.push("CANARY_NOT_INDEPENDENTLY_OBSERVED");
  }

  if (candidate.reconciliation !== "MATCHED") refusals.push("CANARY_NOT_RECONCILED");

  const observedAt = instantMs(candidate.observedAt);
  /* An unparseable date, a date past the window, and a date in the future all
     mean the same thing here: this record cannot be used to say the capability
     works now. A future timestamp is refused rather than treated as maximally
     fresh, because "fresh" would be exactly the wrong reading of a clock that
     is wrong or a record that was written ahead of its event. */
  if (
    observedAt === null
    || observedAt > asOfMs
    || asOfMs - observedAt > CANARY_VALIDITY_DAYS * DAY_MS
  ) {
    refusals.push("CANARY_EXPIRED");
  }

  const decision = candidate.ownerDecision;
  if (
    !isRecord(decision)
    || decision.decision !== "PROMOTE"
    || typeof decision.decidedBy !== "string"
    || decision.decidedBy.trim().length === 0
    || typeof decision.policyVersion !== "string"
    || decision.policyVersion.trim().length === 0
  ) {
    refusals.push("OWNER_DECISION_MISSING");
  }

  return refusals;
}

export function mainnetPromotion(input: {
  capability: string;
  canaries?: readonly unknown[];
  asOf: string;
}): PromotionVerdict {
  const capability = promotableCapability(input.capability);
  const asOfMs = instantMs(input.asOf);
  if (asOfMs === null) throw new Error(`Unparseable asOf: ${String(input.asOf)}`);

  /* A canary belongs to exactly one capability. This filter is the whole of
     "no maturity is inherited": a record that names a different capability is
     not weaker evidence for this one, it is no evidence at all, and the answer
     stays NO_CANARY rather than becoming a partial pass. */
  const mine = (input.canaries ?? []).filter(
    (candidate) => isRecord(candidate) && candidate.capability === capability.id,
  );

  const base = {
    capability: capability.id,
    label: capability.label,
    mainnetChainRef: capability.mainnetChainRef,
    opensWith: capability.opensWith,
  };

  if (mine.length === 0) {
    return Object.freeze({
      ...base,
      state: "BLOCKED" as const,
      refusals: Object.freeze(["NO_CANARY" as const]),
      evidence: null,
    });
  }

  let best: { refusals: readonly MainnetPromotionRefusal[]; canary: MainnetCanary } | null = null;
  for (const candidate of mine) {
    const refusals = refusalsFor(capability, candidate, asOfMs);
    if (best === null || refusals.length < best.refusals.length) {
      best = { refusals, canary: candidate as MainnetCanary };
    }
    if (refusals.length === 0) break;
  }

  const resolved = best as { refusals: readonly MainnetPromotionRefusal[]; canary: MainnetCanary };
  return Object.freeze({
    ...base,
    state: resolved.refusals.length === 0 ? ("PROMOTABLE" as const) : ("BLOCKED" as const),
    refusals: Object.freeze([...resolved.refusals]),
    evidence: resolved.canary,
  });
}

export type MainnetPerimeter = Readonly<{
  /** `PROMOTABLE` only when every capability is. Anything else is `BLOCKED`. */
  state: "PROMOTABLE" | "BLOCKED";
  promotable: number;
  blocked: number;
  capabilities: readonly PromotionVerdict[];
  asOf: string;
}>;

export function mainnetPerimeter(input: {
  canaries?: readonly unknown[];
  asOf: string;
}): MainnetPerimeter {
  const canaries = input.canaries ?? AGENT_CONTROL_CANARIES;
  const capabilities = PROMOTABLE_CAPABILITIES.map((capability) =>
    mainnetPromotion({ capability: capability.id, canaries, asOf: input.asOf }),
  );
  const promotable = capabilities.filter((verdict) => verdict.state === "PROMOTABLE").length;
  return Object.freeze({
    /* The product is on mainnet when all of it is. One promoted capability out
       of eight is a promoted capability, never a promoted product — which is
       the inheritance this module exists to refuse, stated at the perimeter. */
    state: promotable === capabilities.length ? ("PROMOTABLE" as const) : ("BLOCKED" as const),
    promotable,
    blocked: capabilities.length - promotable,
    capabilities: Object.freeze(capabilities),
    asOf: input.asOf,
  });
}
