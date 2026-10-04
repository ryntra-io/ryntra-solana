/*
 * The four economic actions the flagship demo can play, and the deterministic
 * rule that decides each one.
 *
 * Two properties matter more than the content.
 *
 * **It is a pure function.** No model, no randomness, no clock. The same
 * scenario and the same amount always produce the same verdict, which is the
 * only way a demo of a policy engine can be honest about being a policy engine:
 * a page that rolled dice would be showing the opposite of the product.
 *
 * **The precedence is fixed.** Mandate scope, then hard limits, then
 * budget, then counterparty, then evidence freshness, then market state — in
 * that order, so the first reason returned is the one that actually decided.
 * Changing the order here changes the product's meaning, not its presentation.
 */

export type AcDecision = "ALLOW" | "REVIEW" | "BLOCK";

export type AcZone = "runtime" | "ryntra" | "wallet";

export type AcReason = {
  /** The machine code a receipt would carry. */
  code: string;
  /** The same fact in a sentence a person can act on. */
  text: string;
};

export type AcScenario = {
  id: string;
  /** Chip label. Short enough to sit in a row of four on a phone. */
  chip: string;
  agent: string;
  /**
   * What the agent is asking to do, in the product's own words.
   *
   * Takes the money on its own — `$0.10`, not `$0.10 USDC`. The template names
   * the asset where the sentence needs it, because passing both produced
   * "send $40 USDC USDC to a supplier" and "move $500 Tokenized equity of a
   * tokenized security". Neither test noticed: they checked the verdict, and
   * nothing had ever read the sentence out loud.
   */
  ask: (amount: string) => string;
  actionClass: string;
  asset: string;
  amount: number;
  /** The step the amount control moves by, sized to the scenario. */
  step: number;
  unit: string;
  counterparty: string;
  network: string;
  mandate: string;
  /** Action classes this mandate permits. */
  mandateAllows: readonly string[];
  perAction: number;
  budgetRemaining: number;
  /** RWA-shaped facts. Absent for scenarios where they do not apply. */
  referenceStale?: boolean;
  marketClosed?: boolean;
  /** What the receipt would record if the action completed. */
  expectedReceipt: string;
};

export const AC_SCENARIOS: readonly AcScenario[] = [
  {
    id: "paid-api",
    chip: "Paid API",
    agent: "Research Agent",
    ask: (amount) => `pay ${amount} USDC for Market Data API`,
    actionClass: "PAID_READ",
    asset: "USDC",
    amount: 0.1,
    step: 0.05,
    unit: "$",
    counterparty: "market-data.example",
    network: "Base",
    mandate: "Service micropayment · paid reads only",
    mandateAllows: ["PAID_READ"],
    perAction: 0.25,
    budgetRemaining: 31.4,
    expectedReceipt: "Payment settled, resource digest observed, expected vs actual matched.",
  },
  {
    id: "usdc-payment",
    chip: "USDC payment",
    agent: "Ops Agent",
    ask: (amount) => `send ${amount} USDC to a supplier`,
    actionClass: "TRANSFER",
    asset: "USDC",
    amount: 40,
    step: 20,
    unit: "$",
    counterparty: "New payee · first seen today",
    network: "Base",
    mandate: "Treasury · transfers to known payees",
    mandateAllows: ["PAID_READ", "TRANSFER"],
    perAction: 250,
    budgetRemaining: 120,
    expectedReceipt: "Transfer observed on chain, payee and amount reconciled against the approval.",
  },
  {
    id: "token-swap",
    chip: "Token swap",
    agent: "Research Agent",
    ask: (amount) => `swap ${amount} of USDC for a volatile token`,
    actionClass: "SWAP",
    asset: "USDC",
    amount: 25,
    step: 25,
    unit: "$",
    counterparty: "DEX router",
    network: "Base",
    mandate: "Service micropayment · paid reads only",
    mandateAllows: ["PAID_READ"],
    perAction: 0.25,
    budgetRemaining: 31.4,
    expectedReceipt: "Not reachable: the mandate does not cover this action class.",
  },
  {
    id: "rwa-transfer",
    chip: "RWA transfer",
    agent: "Treasury Agent",
    ask: (amount) => `move ${amount} of a tokenized security`,
    actionClass: "TRANSFER",
    asset: "Tokenized equity",
    amount: 500,
    step: 500,
    unit: "$",
    counterparty: "Issuer transfer agent",
    network: "Base",
    mandate: "RWA · transfers inside issuer allowlist",
    mandateAllows: ["PAID_READ", "TRANSFER"],
    perAction: 5000,
    budgetRemaining: 5000,
    /* The beachhead in one row: the token trades 24/7, the thing behind it does
       not, and the reference price is older than the policy allows. */
    referenceStale: true,
    marketClosed: true,
    expectedReceipt: "Eligibility, fill, settlement and post-state reconciled against the mandate.",
  },
];

export type AcOutcome = {
  decision: AcDecision;
  /** Reasons in precedence order; the first one is why. */
  reasons: readonly AcReason[];
  /** What a person has to do next, or what happens without them. */
  humanStep: string;
  /** The phase the action reaches. Later phases are not entered. */
  reachedPhase: number;
};

export type AcPhase = {
  key: string;
  name: string;
  zone: AcZone;
  /** What this phase does, in one line. */
  detail: string;
};

/** The five public phases, each tagged with who is holding the action. */
export const AC_PHASES: readonly AcPhase[] = [
  { key: "propose", name: "Propose", zone: "runtime", detail: "The agent states an exact economic action." },
  { key: "verify", name: "Verify", zone: "ryntra", detail: "Mandate, budget, evidence and policy are checked." },
  { key: "authorize", name: "Authorize", zone: "ryntra", detail: "A human or a bounded mandate authorizes these exact bytes." },
  { key: "execute", name: "Execute", zone: "wallet", detail: "An external wallet signs; an external rail settles." },
  { key: "prove", name: "Prove", zone: "ryntra", detail: "The actual outcome is observed and reconciled." },
];

export const AC_ZONES: Readonly<Record<AcZone, string>> = {
  runtime: "External runtime",
  ryntra: "Ryntra control boundary",
  wallet: "External wallet / rail",
};

/** Money as the panel prints it: cents for small asks, whole units above ten. */
export function acAmountLabel(scenario: AcScenario, amount: number): string {
  const digits = scenario.step < 1 ? 2 : 0;
  return `${scenario.unit}${amount.toFixed(digits)}`;
}

/**
 * The decision.
 *
 * `counterpartyKnown` is a control rather than a scenario field because the
 * brief asks a reader to see that changing the counterparty alone moves the
 * verdict — which is the cheapest way to show that the engine reads facts
 * rather than replaying a script.
 */
export function acDecide(
  scenario: AcScenario,
  amount: number,
  counterpartyKnown: boolean,
): AcOutcome {
  const reasons: AcReason[] = [];

  // 1. Mandate scope. An action class outside the mandate is not a budget
  //    question and never becomes one.
  if (!scenario.mandateAllows.includes(scenario.actionClass)) {
    reasons.push({
      code: "MANDATE_SCOPE",
      text: `The mandate covers ${scenario.mandateAllows.join(", ")}. This action is ${scenario.actionClass}.`,
    });
    return {
      decision: "BLOCK",
      reasons,
      humanStep: "Nothing to approve. Widening authority needs a new mandate version, confirmed by the owner.",
      reachedPhase: 1,
    };
  }

  // 2. Hard per-action limit.
  if (amount > scenario.perAction) {
    reasons.push({
      code: "PER_ACTION_LIMIT",
      text: `${acAmountLabel(scenario, amount)} is over the ${acAmountLabel(scenario, scenario.perAction)} per-action limit.`,
    });
    return {
      decision: "BLOCK",
      reasons,
      humanStep: "Nothing to approve. Lower the amount or raise the limit in a new mandate version.",
      reachedPhase: 1,
    };
  }

  // 3. Budget.
  if (amount > scenario.budgetRemaining) {
    reasons.push({
      code: "BUDGET_EXCEEDED",
      text: `${acAmountLabel(scenario, amount)} is over the ${acAmountLabel(scenario, scenario.budgetRemaining)} remaining today.`,
    });
    return {
      decision: "BLOCK",
      reasons,
      humanStep: "Nothing to approve until the budget resets or the owner raises it.",
      reachedPhase: 1,
    };
  }

  // 4–6. Everything below escalates rather than refuses: the action is inside
  //      the mandate, but a fact a person should see is missing or stale.
  if (!counterpartyKnown) {
    reasons.push({
      code: "COUNTERPARTY_UNKNOWN",
      text: "The counterparty has no prior verified interaction under this mandate.",
    });
  }
  if (scenario.referenceStale) {
    reasons.push({
      code: "REFERENCE_STALE",
      text: "The reference price is older than the policy allows for this asset.",
    });
  }
  if (scenario.marketClosed) {
    reasons.push({
      code: "MARKET_HOURS_MISMATCH",
      text: "The token trades continuously; the underlying market is closed right now.",
    });
  }

  if (reasons.length > 0) {
    return {
      decision: "REVIEW",
      reasons,
      humanStep: "A person approves these exact bytes, or the action expires. Changing any field invalidates the approval.",
      reachedPhase: 2,
    };
  }

  return {
    decision: "ALLOW",
    reasons: [
      {
        code: "WITHIN_MANDATE",
        text: `Inside the mandate, under the per-action limit and within the ${acAmountLabel(scenario, scenario.budgetRemaining)} remaining today.`,
      },
    ],
    humanStep: "No human step: the bounded mandate already covers this exact action class and amount.",
    reachedPhase: 4,
  };
}
