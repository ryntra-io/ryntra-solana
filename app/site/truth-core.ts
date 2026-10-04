/* Relative imports with explicit extensions: this module is loaded directly by
   `node --test`, which does not resolve the TypeScript path alias. The server
   entry point is `truth.ts`, which adds the `server-only` guard — the registry
   is 36 kB of scopes and evidence and has no business in a browser bundle. */
import {
  getCapabilityFreshness,
  productCapabilityById,
  type CapabilityMaturity,
  type ProductCapabilityId,
  type PublicCapability,
} from "../../lib/product/capabilities.ts";

import {
  STATE_LABEL,
  STATE_TONE,
  type ActionRow,
  type CircuitStage,
  type EnvironmentRow,
  type PublicCapabilityRow,
  type PublicState,
  type PublicSurfaceRow,
  type SiteTruth,
  type WalkFact,
  type WalkStep,
} from "./truth-view.ts";

/**
 * One status source for the whole public site.
 *
 * The rule this file exists to enforce: marketing copy is not the source of
 * product truth. Every badge, every colour and every "what works today" line
 * on the redesigned site resolves through here, from
 * `lib/product/capabilities.ts` — so a section cannot quietly advertise a
 * maturity the product has not reached, and a page written six weeks from now
 * cannot disagree with the registry about the same id.
 *
 * It also fails closed. A claim whose review window has expired renders as
 * `Re-verifying`, never as its old confident label, because an aging claim and
 * a fresh one are not the same fact.
 */

/** Registry maturity → public vocabulary, before freshness is applied. */
const MATURITY_STATE: Readonly<Record<CapabilityMaturity, PublicState>> = {
  live: "live",
  testnet: "testnet_verified",
  paper: "paper",
  preview: "preview",
  /* `in_build` until 2026-08-14. A registered-but-unstarted capability was
     advertised as work in progress, which is a claim about the present and not
     about the roadmap. The registry always knew the difference; the public
     vocabulary now does too. */
  planned: "planned",
  after_gate: "after_gate",
};

/**
 * How weak a state is. A surface bound to several capabilities advertises the
 * weakest of them, so "Planning & Strategy" cannot borrow the confidence of its
 * strongest part.
 */
export const STATE_RANK: Readonly<Record<PublicState, number>> = {
  research: 0,
  after_gate: 1,
  /* Weaker than `in_build`: registered and not started is less than started.
     A surface bound to both must advertise the planned one. */
  planned: 2,
  in_build: 3,
  preview: 4,
  paper: 5,
  testnet_verified: 6,
  live: 7,
  // Never compared by rank — a re-verifying claim short-circuits the fold below.
  re_verifying: 99,
};

function scopeOf(capability: PublicCapability): string {
  const parts = [
    capability.scope.provider?.label,
    capability.scope.route,
    capability.scope.assets.length ? capability.scope.assets.join(" · ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Ryntra product layer";
}

/**
 * The single resolution point. Freshness is re-evaluated at read time against
 * the route registry, so a route that drifted downgrades the claim without
 * anyone editing a page.
 */
function stateFor(id: ProductCapabilityId, now: Date): PublicState {
  const capability = productCapabilityById(id);
  const freshness = getCapabilityFreshness(capability, now);
  if (freshness !== "fresh") return "re_verifying";
  return MATURITY_STATE[capability.maturity];
}

function rowFor(id: ProductCapabilityId, now: Date): PublicCapabilityRow {
  const capability = productCapabilityById(id);
  const state = stateFor(id, now);
  return {
    id: capability.id,
    label: capability.label,
    state,
    stateLabel: STATE_LABEL[state],
    tone: STATE_TONE[state],
    scope: scopeOf(capability),
    limitation: capability.limitation,
    lastVerifiedAt: capability.lastVerifiedAt,
  };
}

/**
 * One registry row, resolved through the same single point as the whole site
 * truth.
 *
 * Exported for pages that state a handful of named capabilities rather than the
 * entire product — `/stellar` is the first. Without it such a page would read
 * `maturity` directly and skip `stateFor`, which is where a claim that has aged
 * out of its review window becomes `Re-verifying`. That is precisely the gate
 * four hard-coded surfaces once bypassed.
 */
export function publicCapabilityRow(
  id: ProductCapabilityId,
  now: Date = new Date(),
): PublicCapabilityRow {
  return rowFor(id, now);
}

function foldStates(states: readonly PublicState[]): PublicState {
  if (!states.length) return "in_build";
  if (states.includes("re_verifying")) return "re_verifying";
  return states.reduce((weakest, state) =>
    STATE_RANK[state] < STATE_RANK[weakest] ? state : weakest,
  );
}

/**
 * The five product surfaces the homepage narrates, each bound to the registry
 * ids that would have to be true for the surface to be usable.
 *
 * `capabilityIds` is the load-bearing field: the copy beside it is editorial,
 * the state beneath it is not.
 */
const SURFACE_DEFINITIONS: readonly Readonly<{
  id: string;
  name: string;
  promise: string;
  problem: string;
  capabilityIds: readonly ProductCapabilityId[];
  /** Used when no registry id can carry the surface. */
  fixedState?: PublicState;
  fixedScope?: string;
}>[] = [
  {
    id: "workspace",
    name: "Workspace",
    promise: "A configurable operating surface for risk-first decisions.",
    problem:
      "A decision made across six tabs leaves no record of why it was made. The workspace keeps the plan, the evidence and the outcome in one place.",
    capabilityIds: ["personal-workspace"],
  },
  {
    id: "scanner",
    name: "Scanner",
    promise: "Facts, flags, unknowns, sources and freshness — never a safe score.",
    problem:
      "Risk tools collapse a dozen unrelated questions into one number. A single score hides which input was missing.",
    capabilityIds: ["risk-readiness-scanner", "rwa-risk-pack"],
  },
  {
    id: "planning",
    name: "Planning & Strategy",
    promise: "Turn an idea into explicit rules, limits, invalidation and evidence requirements.",
    problem:
      "An unwritten plan cannot be broken, so it cannot be reviewed. Writing it down is what makes the review possible.",
    capabilityIds: ["smarttrade-plan"],
  },
  {
    id: "receipts",
    name: "Receipts & Journal",
    promise: "Compare the plan with the actual outcome and carry the learning forward.",
    problem:
      "Execution, settlement and the original decision can remain separated. Ryntra records their comparison explicitly.",
    capabilityIds: ["decision-journal", "complete-decision-loop"],
  },
];

/**
 * Environments and adapters — the product calls them exactly that.
 *
 * They are not partners, and this file has no field in which a partnership
 * could be recorded. Ethereum and Solana carry `research` because no adapter
 * exists; a chain listed without a state is how a marquee starts implying
 * shipped support.
 */
const ENVIRONMENT_DEFINITIONS: readonly Readonly<{
  id: string;
  name: string;
  kind: EnvironmentRow["kind"];
  role: string;
  capabilityIds: readonly ProductCapabilityId[];
  fixedState?: PublicState;
  fixedScope?: string;
}>[] = [
  {
    id: "robinhood-chain",
    name: "Robinhood Chain",
    kind: "Chain pack",
    role: "Tokenized-asset settlement, market-session context and RWA evidence.",
    capabilityIds: ["rwa-risk-pack", "portfolio-heat"],
  },
  {
    id: "arcus",
    name: "Arcus",
    kind: "Venue adapter",
    role: "Ryntra's initial shipped trading adapter, for wallet-signed routes that were each proven individually.",
    capabilityIds: ["arcus-spot-rfq", "arcus-account-read"],
  },
  {
    id: "ethereum",
    name: "Ethereum",
    kind: "Chain pack",
    role: "DeFi and RWA liquidity, approvals, contract and MEV evidence.",
    capabilityIds: [],
    fixedState: "research",
    fixedScope: "No adapter exists. Designed, not built.",
  },
  {
    id: "solana",
    name: "Solana",
    kind: "Chain pack",
    role: "Separate signer and indexer semantics, high-speed routing, token intelligence.",
    capabilityIds: [],
    fixedState: "research",
    fixedScope: "No adapter exists. Designed, not built.",
  },
];

/**
 * The Decision Circuit — the eight stages the whole site is drawn around.
 *
 * The `never` line on each stage is the one that earns the rest. A control
 * layer that will not say what it refuses to do is just a dashboard, and the
 * boundaries here are the ones Ryntra is actually built to hold: no model
 * supplies a missing fact, no model decides policy, and nothing signs but the
 * person whose wallet it is.
 */
const CIRCUIT_DEFINITIONS: readonly Readonly<{
  id: string;
  index: string;
  name: string;
  takes: string;
  makes: string;
  actor: string;
  never: string;
  capabilityIds: readonly ProductCapabilityId[];
  fixedState?: PublicState;
  fixedScope?: string;
}>[] = [
  {
    id: "observe",
    index: "01",
    name: "Observe",
    takes: "An asset, a venue, a wallet, a market session.",
    makes: "Facts, flags, explicit unknowns, each with a source and an observation time.",
    actor: "Ryntra Scanner, reading external providers.",
    never: "Declare an asset safe. Popularity is evidence of attention, not of safety.",
    capabilityIds: ["risk-readiness-scanner", "rwa-risk-pack"],
  },
  {
    id: "plan",
    index: "02",
    name: "Plan",
    takes: "An intention, a risk budget, the limits a person is willing to accept.",
    makes: "A PlanDefinition: entry, exit, invalidation, max loss, required evidence.",
    actor: "The user, with the Planner formalizing what they wrote.",
    never: "Invent a target, a size or a level the user did not choose.",
    capabilityIds: ["smarttrade-plan"],
  },
  {
    id: "evidence",
    index: "03",
    name: "Gather evidence",
    takes: "A normalized intent and the evidence that intent requires.",
    makes: "An EvidenceBundle: provider, source reference, observed-at, validity, coverage, digest.",
    actor: "The Evidence Kernel, over provider adapters.",
    never: "Fill a gap with a plausible value. Missing stays missing, and stale stays stale.",
    capabilityIds: ["supported-route-readiness"],
  },
  {
    id: "policy",
    index: "04",
    name: "Evaluate policy",
    takes: "The intent, the evidence bundle, and one versioned policy.",
    makes: "ALLOWED_BY_POLICY, REVIEW_REQUIRED or BLOCKED_BY_RULE, with the rule that produced it.",
    actor: "A deterministic engine. No model sits on this path.",
    never:
      "Mean safe, legal or profitable. It means the action matched the configured rules against the evidence available at that moment.",
    /* No registered capability of the product carries this stage on its own,
       and a stage may not borrow another row's proof. */
    capabilityIds: [],
    fixedState: "in_build",
    fixedScope: "Deterministic policy engine in the Evidence Kernel · no registered capability of its own",
  },
  {
    id: "authorize",
    index: "05",
    name: "Authorize",
    takes: "Exactly what will be sent: target, calldata, amount, recipient, fee ceiling.",
    makes: "An authorization record bound to the intent revision, evidence root and execution fingerprint.",
    actor: "A person, deliberately, as an act separate from the policy result.",
    never: "Sign for you. Ryntra holds no key, no seed phrase and no withdrawal authority.",
    capabilityIds: ["arcus-spot-rfq"],
  },
  {
    id: "execute",
    index: "06",
    name: "Execute",
    takes: "The authorized payload and the fingerprint it was bound to.",
    makes: "A submission, a transaction reference, and an execution state that survives failure.",
    actor: "The user's own wallet, through a chain or venue adapter.",
    never: "Rebroadcast on its own after an uncertain result. The captured hash is kept and the state says so.",
    capabilityIds: ["arcus-spot-rfq"],
  },
  {
    id: "reconcile",
    index: "07",
    name: "Reconcile",
    takes: "The effects that were authorized and the effects the chain actually confirmed.",
    makes: "A reconciliationStatus of NOT_RECONCILED, RECONCILIATION_REQUIRED, MATCHED or DEVIATION_RECORDED — and, only after finalization, a structured receipt.",
    actor: "The Reconciliation Engine, reading settlement rather than the estimate.",
    never: "Smooth over a difference. A drift is reported as a drift.",
    /* Same rule as the policy stage: no registered capability carries it alone. */
    capabilityIds: [],
    fixedState: "in_build",
    fixedScope: "Reconciliation in the Evidence Kernel · no registered capability of its own",
  },
  {
    id: "review",
    index: "08",
    name: "Review",
    takes: "The receipt, the original plan, and what the person actually did.",
    makes: "A review record and the next version of the plan — approved by a human.",
    actor: "The user, with the Journal holding the comparison.",
    never: "Promote a review into a recommendation, or a past outcome into a forecast.",
    capabilityIds: ["decision-journal"],
  },
];

/**
 * The consumer walkthrough — Understand → Plan → Check risk → Authorize →
 * Review.
 *
 * This is the composition the homepage leads with, and the rule that keeps it
 * honest is one capability per step. The five steps deliberately do not resolve
 * to one state: two are live on a scoped route, one is live read-only, and two
 * are paper. A five-step story with five identical green badges would be a
 * better advertisement and a worse description of the product.
 *
 * The sample content names fields and their state vocabulary. It never invents
 * a price, a balance, a fill, a transaction hash, an address or a provider
 * response — a walkthrough that fabricates a number to look alive is exactly
 * the decorative mockup this site must never show.
 */
const WALK_DEFINITIONS: readonly Readonly<{
  id: string;
  n: string;
  name: string;
  lead: string;
  facts: readonly WalkFact[];
  capabilityId: ProductCapabilityId;
}>[] = [
  {
    id: "understand",
    n: "01",
    name: "Understand",
    lead: "See what is actually known about a supported asset — and what is not.",
    capabilityId: "rwa-risk-pack",
    facts: [
      { kind: "KNOWN", text: "The supported pair, its venue and the contract behind it." },
      { kind: "KNOWN", text: "Market session and reference-price freshness, each with its source and observation time." },
      { kind: "UNKNOWN", text: "Anything unread stays unknown. A gap is never filled with a plausible value." },
      { kind: "LIMIT", text: "A Stock Token is exposure to a token. It is not ownership of the underlying share." },
    ],
  },
  {
    id: "plan",
    n: "02",
    name: "Plan",
    lead: "Write the plan down before the market writes one for you.",
    capabilityId: "smarttrade-plan",
    facts: [
      { kind: "YOU SET", text: "The idea and the condition that would start it." },
      { kind: "YOU SET", text: "A risk budget and a maximum size you are willing to lose." },
      { kind: "YOU SET", text: "Invalidation — the observation that would make this wrong." },
      { kind: "LIMIT", text: "Recorded and simulated only. No order is created, and paper is where this starts." },
    ],
  },
  {
    id: "check",
    n: "03",
    name: "Check risk",
    lead: "Deterministic checks first, then every unknown by name.",
    capabilityId: "supported-route-readiness",
    facts: [
      { kind: "CHECKED", text: "Route availability for the exact pair and input amount." },
      { kind: "CHECKED", text: "Fee and slippage context for that quote, shown before you decide." },
      { kind: "SHOWN", text: "Each input that is missing, stale or unavailable, listed rather than averaged away." },
      { kind: "NEVER", text: "A safe verdict. Allowed by policy means the rules matched the evidence at that moment." },
    ],
  },
  {
    id: "authorize",
    n: "04",
    name: "Authorize",
    lead: "You sign, in your own wallet. Ryntra never signs for you.",
    capabilityId: "arcus-spot-rfq",
    facts: [
      { kind: "EXACT", text: "The payload you approve: pair, amount, route and the provider that will fill it." },
      { kind: "YOURS", text: "Ryntra holds no key, no seed phrase and no withdrawal authority." },
      { kind: "SCOPE", text: "Wallet-signed RFQ on USDG↔TSLA, USDG↔AAPL and USDG↔AMD. Nothing else executes." },
      { kind: "SEPARATE", text: "Route availability, wallet state and your eligibility are re-checked for every attempt." },
    ],
  },
  {
    id: "review",
    n: "05",
    name: "Review",
    lead: "Compare what you planned with what actually happened.",
    capabilityId: "decision-journal",
    facts: [
      { kind: "COMPARED", text: "The plan you wrote against the fill context that was observed." },
      { kind: "RECORDED", text: "What you did — including whether you followed your own plan." },
      { kind: "CARRIED", text: "One note that changes the next plan rather than the last one." },
      { kind: "LIMIT", text: "Paper records and observed Arcus fill context. The complete loop is not shipped." },
    ],
  },
];

/**
 * What a person can do now, in their language rather than the registry's.
 *
 * One card, one capability id, one badge. The title is editorial; the state,
 * the scope and the limitation under it are the registry's answer, so a card
 * cannot outlive the claim it describes.
 */
const TODAY_DEFINITIONS: readonly Readonly<{
  title: string;
  body: string;
  capabilityId: ProductCapabilityId;
}>[] = [
  {
    capabilityId: "arcus-spot-rfq",
    title: "Trade three supported tokenized stocks",
    body: "Swap between USDG and TSLA, AAPL or AMD on Arcus spot, signed in your own wallet.",
  },
  {
    capabilityId: "rwa-risk-pack",
    title: "Read the risk context of a tokenized asset",
    body: "Market session, reference-price freshness and issuer context for supported contracts, with sources named.",
  },
  {
    capabilityId: "supported-route-readiness",
    title: "Run readiness checks before you act",
    body: "Deterministic checks on the exact route and amount, with every unknown listed rather than hidden.",
  },
  {
    capabilityId: "uniswap-quote-comparison",
    title: "Compare the quote against Uniswap v3",
    body: "The same pair and the same input amount, quoted a second way so the first number has something to answer to.",
  },
  {
    capabilityId: "portfolio-heat",
    title: "See how concentrated your Stock Tokens are",
    body: "Exposure, concentration and correlated-family warnings across the supported holdings in your connected wallet.",
  },
  {
    capabilityId: "arcus-account-read",
    title: "See your positions, orders and fills",
    body: "Read supported Arcus account data by public wallet address, without granting anything.",
  },
  {
    capabilityId: "smarttrade-plan",
    title: "Build a plan and paper-test it",
    body: "Entry, risk budget, size and invalidation written down, then simulated before any real money is involved.",
  },
  {
    capabilityId: "decision-journal",
    title: "Keep a decision journal",
    body: "What you decided, why, and whether you stuck to it — so the next plan is a correction rather than a guess.",
  },
  {
    capabilityId: "arcus-trade-key-setup",
    title: "Connect and revoke your Arcus trade key",
    body: "Approve the setup in your wallet, and take it back whenever you want.",
  },
  {
    capabilityId: "telegram-daily-recap",
    title: "Get your decision recap in Telegram",
    body: "A summary of what you recorded. It is a recap, never an instruction to trade.",
  },
];

/**
 * What is being built, kept visibly apart from what works.
 *
 * Every row carries its own preview, planned or behind-a-gate state. There is
 * no date, no quarter and no percentage here: progress is gate-based, and a
 * homepage is exactly where a calendar promise gets made.
 */
const NEXT_DEFINITIONS: readonly Readonly<{
  title: string;
  body: string;
  capabilityId: ProductCapabilityId;
}>[] = [
  {
    capabilityId: "strategy-lab-v1",
    title: "Strategy Lab",
    body: "Reusable, versioned strategy definitions with their own evidence and scenarios.",
  },
  {
    capabilityId: "risk-readiness-scanner",
    title: "A broader scanner",
    body: "Facts, flags, unknowns and freshness beyond the currently supported scope — never a safety score.",
  },
  {
    capabilityId: "complete-decision-loop",
    title: "The complete decision loop",
    body: "Plan to readiness to disposition to receipt to review to the next plan, as one continuous flow.",
  },
  {
    capabilityId: "personal-workspace",
    title: "A personal workspace",
    body: "Simple and Pro depth over the same facts, arranged the way you actually work.",
  },
  {
    capabilityId: "complete-portfolio-risk",
    title: "Portfolio-wide risk",
    body: "Exposure, concentration, correlation and scenario loss across normalized venues and asset classes.",
  },
  {
    capabilityId: "multi-venue-overlay",
    title: "More than one venue",
    body: "The first added connection may be manual or read-only, and it may be no venue at all.",
  },
  {
    capabilityId: "replay-robustness",
    title: "Replay and robustness",
    body: "Timestamp-correct replay that cannot see the future and cannot imply a fill.",
  },
  {
    capabilityId: "pro-order-flow",
    title: "Professional order flow",
    body: "Depth, tape and volume profile, once a suitable feed and its display rights exist.",
  },
  {
    capabilityId: "guarded-automation",
    title: "Guarded automation",
    body: "Scoped authority with limits, simulation, a kill switch and human authorization that cannot be bypassed.",
  },
  {
    capabilityId: "sequencer-monitoring",
    title: "Independent sequencer monitoring",
    body: "Not claimed today: there is no verified observable source, so the signal stays unknown rather than healthy.",
  },
];

/** Every registry id the public site is allowed to surface, in reading order. */
const PUBLIC_ORDER: readonly ProductCapabilityId[] = [
  "arcus-spot-rfq",
  "arcus-account-read",
  "arcus-trade-key-setup",
  "supported-route-readiness",
  "rwa-risk-pack",
  "portfolio-heat",
  "uniswap-quote-comparison",
  "telegram-daily-recap",
  "smarttrade-plan",
  "decision-journal",
  /* Gate M0 reconciliation: the Solana workspace has three public registry
     rows and Current Capabilities must not silently omit the chain pack it
     routes to. The CCTP row remains preview/read-only and states that no
     transfer or receipt exists. */
  "solana-asset-passport",
  "solana-swap-quote-preview",
  "solana-cctp-precanary",
  "strategy-lab-v1",
  "risk-readiness-scanner",
  "personal-workspace",
  "complete-decision-loop",
  "complete-portfolio-risk",
  "multi-venue-overlay",
  "replay-robustness",
  "pro-order-flow",
  "guarded-automation",
  "sequencer-monitoring",
];

export function getSiteTruth(now = new Date()): SiteTruth {
  const capabilities = PUBLIC_ORDER.map((id) => rowFor(id, now));

  const surfaces: readonly PublicSurfaceRow[] = SURFACE_DEFINITIONS.map((definition) => {
    const bound = definition.capabilityIds.map((id) => productCapabilityById(id));
    const boundState = foldStates(definition.capabilityIds.map((id) => stateFor(id, now)));
    /* A fixed state is a ceiling, not an exemption from freshness: if the
       evidence behind a surface ages out, the surface becomes Re-verifying. */
    const state =
      boundState === "re_verifying" ? boundState : definition.fixedState ?? boundState;
    const scope =
      definition.fixedScope ??
      (bound.length ? bound.map(scopeOf).join(" · ") : "Ryntra product layer");
    return {
      id: definition.id,
      name: definition.name,
      promise: definition.promise,
      problem: definition.problem,
      state,
      stateLabel: STATE_LABEL[state],
      tone: STATE_TONE[state],
      scope,
      capabilityIds: definition.capabilityIds,
    };
  });

  const environments: readonly EnvironmentRow[] = ENVIRONMENT_DEFINITIONS.map((definition) => {
    const state =
      definition.fixedState ??
      foldStates(definition.capabilityIds.map((id) => stateFor(id, now)));
    const scope =
      definition.fixedScope ??
      definition.capabilityIds.map((id) => scopeOf(productCapabilityById(id))).join(" · ");
    return {
      id: definition.id,
      name: definition.name,
      kind: definition.kind,
      role: definition.role,
      state,
      stateLabel: STATE_LABEL[state],
      tone: STATE_TONE[state],
      scope,
    };
  });

  const circuit: readonly CircuitStage[] = CIRCUIT_DEFINITIONS.map((definition) => {
    const state =
      definition.fixedState ??
      foldStates(definition.capabilityIds.map((id) => stateFor(id, now)));
    const scope =
      definition.fixedScope ??
      definition.capabilityIds.map((id) => scopeOf(productCapabilityById(id))).join(" · ");
    return {
      id: definition.id,
      index: definition.index,
      name: definition.name,
      takes: definition.takes,
      makes: definition.makes,
      actor: definition.actor,
      never: definition.never,
      state,
      stateLabel: STATE_LABEL[state],
      tone: STATE_TONE[state],
      scope,
    };
  });

  const walkthrough: readonly WalkStep[] = WALK_DEFINITIONS.map((definition) => {
    const capability = productCapabilityById(definition.capabilityId);
    const state = stateFor(definition.capabilityId, now);
    return {
      id: definition.id,
      n: definition.n,
      name: definition.name,
      lead: definition.lead,
      facts: definition.facts,
      state,
      stateLabel: STATE_LABEL[state],
      tone: STATE_TONE[state],
      scope: scopeOf(capability),
      limitation: capability.limitation,
    };
  });

  const actionRow = (
    definition: Readonly<{ title: string; body: string; capabilityId: ProductCapabilityId }>,
  ): ActionRow => {
    const capability = productCapabilityById(definition.capabilityId);
    const state = stateFor(definition.capabilityId, now);
    return {
      id: capability.id,
      title: definition.title,
      body: definition.body,
      state,
      stateLabel: STATE_LABEL[state],
      tone: STATE_TONE[state],
      scope: scopeOf(capability),
      limitation: capability.limitation,
    };
  };

  const isAllowedOnLanding = (
    definition: Readonly<{ capabilityId: ProductCapabilityId }>,
  ) => productCapabilityById(definition.capabilityId).publicSurfaces.includes("landing");

  /* "Available now" is a stronger funnel claim than a caution badge. A row
     therefore leaves that group entirely when its evidence is stale, and a
     capability not registered for the landing surface never reaches it. */
  const today: readonly ActionRow[] = TODAY_DEFINITIONS
    .filter(isAllowedOnLanding)
    .map(actionRow)
    .filter((row) => row.state !== "re_verifying");
  const next: readonly ActionRow[] = NEXT_DEFINITIONS
    .filter(isAllowedOnLanding)
    .map(actionRow);

  return {
    capabilities,
    surfaces,
    environments,
    circuit,
    walkthrough,
    today,
    next,
    anyReVerifying: capabilities.some((row) => row.state === "re_verifying"),
    registryVerifiedAt: capabilities
      .map((row) => row.lastVerifiedAt)
      .sort()[0] ?? "",
  };
}
