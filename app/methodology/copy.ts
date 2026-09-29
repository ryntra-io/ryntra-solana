/**
 * Methodology page copy — English only.
 *
 * The public surface is English (founder decision 2026-08-06); the parked
 * locales keep their existing `METHODOLOGY_SUMMARY` translations and reach this
 * page through a temporary 307. When a locale is unparked this file grows a
 * locale dimension; until then a second dictionary would be unrendered copy,
 * which is the drift earlier canon work removed.
 *
 * Nothing here states a capability. Every maturity, limitation, evidence count
 * and review date on the page is rendered from the typed registry.
 */

export const METHODOLOGY_COPY = {
  hero: {
    eyebrow: "DECISION & SETTLEMENT EVIDENCE LAYER",
    title: "Methodology & product truth",
    lead: "Ryntra shows what is known, what is unknown, and what is supported before you act. You remain the decision-maker and authorize every wallet action yourself.",
    method: "Plan. Prove. Improve.",
    trust: "Non-custodial. Paper-first. Human-authorized. No profit promises.",
    primary: "Open free beta",
    secondary: "View current capabilities",
  },

  /**
   * The method model, shown in the hero.
   *
   * Plain-language label first, internal term second — a first-time visitor
   * should not have to learn "StrategySpec" to understand step one.
   */
  methodModel: {
    label: "METHOD MODEL",
    status: "TARGET METHOD · NOT SHIPPED END TO END",
    note: "The complete decision loop is the target product model. Current live, read-only, paper, preview, and planned components are identified separately below.",
    steps: [
      { plain: "Plan", term: "StrategySpec" },
      { plain: "Check the evidence", term: "Deterministic readiness" },
      { plain: "Choose what happens next", term: "No trade / Paper / Manual / Supported live" },
      { plain: "Record the decision", term: "DecisionReceipt" },
      { plain: "Review what happened", term: "ReviewRecord" },
      { plain: "Improve the next plan", term: "Human-approved next StrategySpec" },
    ],
  },

  quick: {
    eyebrow: "OVERVIEW",
    title: "Ryntra in 30 seconds",
    cards: [
      {
        h: "Evidence before action",
        p: "Ryntra checks supported data, freshness, limitations, and conflicts before showing what can happen next.",
      },
      {
        h: "Human authority always",
        p: "Ryntra can explain risk and prepare a supported action. It cannot decide, sign, or authorize a wallet for you.",
      },
      {
        h: "Shipped truth stays separate",
        p: "Every capability is labelled by its real maturity, scope, evidence, limitations, and recovery path.",
      },
    ],
  },

  nav: {
    label: "Methodology sections",
    items: [
      { id: "overview", label: "Overview" },
      { id: "decision-method", label: "Decision method" },
      { id: "maturity", label: "Maturity" },
      { id: "capability-registry", label: "Capabilities" },
      { id: "evidence-policy", label: "Evidence" },
      { id: "authority", label: "Human authority" },
    ],
  },

  registry: {
    search: "Search capabilities",
    searchPlaceholder: "Name, ID, provider, route, asset…",
    provider: "Provider",
    providerAll: "All providers",
    clear: "Clear filters",
    filtersLabel: "Filter by maturity",
    all: "All",
    /** Rendered around a count derived from the registry, never hardcoded. */
    countOne: "capability",
    countMany: "capabilities",
    showing: "Showing",
    of: "of",
    details: "View details",
    hide: "Hide details",
    empty: "No capabilities match these filters. Clear one or more filters to return to the full registry.",
    note: "Every row is rendered from the typed capability registry. “Last reviewed” describes the exact Ryntra claim — not provider uptime, current market data, execution success, safety, or an individual user's eligibility.",
    reviewedPerRow: "Evidence reviewed per row",
  },

  /**
   * Plain-language line per maturity, shown beside the technical definition the
   * page already published. The technical text is unchanged.
   */
  maturityPlain: {
    live: "Works today, inside the exact scope named on the row.",
    testnet: "Really happened, on a test network, for one exact operation. Test assets are not money.",
    paper: "No real order, no asset movement.",
    preview: "Being evaluated. Not deployed, not generally available.",
    planned: "Not available. A sequenced outcome, not a current capability.",
    after_gate: "Blocked until a named legal, security, reliability, data-rights, or provider gate passes.",
  },

  /** Evidence states, which are freshness rather than maturity. */
  freshnessPlain: {
    title: "Evidence states",
    rows: [
      { k: "Fresh", v: "Reviewed within the policy window for this claim." },
      { k: "Stale", v: "Past its review window. It cannot support a positive state until re-reviewed." },
      { k: "Unavailable", v: "Required evidence is missing. The claim fails closed rather than degrading quietly." },
    ],
  },

  authority: {
    mayTitle: "Ryntra may",
    mayNotTitle: "Ryntra may not",
    may: [
      "Organize evidence",
      "Identify supported risk conditions",
      "Show unknowns",
      "Prepare a paper or supported action",
      "Explain why a gate passed or failed",
      "Preserve a decision record",
    ],
    mayNot: [
      "Declare an asset safe",
      "Provide a guaranteed result",
      "Decide for the user",
      "Override deterministic readiness",
      "Approve wallet authorization",
      "Sign a transaction",
      "Hold funds",
      "Obtain withdrawal authority",
      "Execute an unsupported action",
      "Convert unknown evidence into a positive state",
    ],
  },

  final: {
    eyebrow: "READY TO SEE THE PRODUCT?",
    title: "See the risk before you sign.",
    body: "Open the free beta, review the supported routes, and remain in control of every wallet authorization.",
    primary: "Open free beta",
    secondary: "Back to Ryntra",
    note: "No custody. No deposits. No automatic signing.",
  },
} as const;
