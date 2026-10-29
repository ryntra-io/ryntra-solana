/**
 * The mandate gate: when an agent of Ryntra may spend without a person
 * signing, and when it may not.
 *
 * The rule is the owner's, recorded in the registry row for this task after the
 * EXE-0 signer review: **an agent acts without a human signature only where the
 * program itself holds both the recipient and the end date.** Two mandates on
 * Solana do; three do not, and the three are named here rather than left to be
 * discovered.
 *
 * | Program state | Recipient held by | End date held by | Agent alone |
 * |---|---|---|---|
 * | Squads Smart Account spending-limit policy | the program (destination list) | the program (expiry) | yes |
 * | Subscriptions merchant plan | the program (destination list) | the program (`endTs`) | yes |
 * | Squads v4 spending limit | the program (destination list) | **nobody** — v4 has no expiry | no |
 * | Subscriptions fixed delegation | **nobody** — a delegatee, not a recipient | the program (expiry) | no |
 * | Subscriptions recurring delegation | **nobody** — same | the program (expiry) | no |
 * | Pull Program (Blueshift) | unverified — no audit | unverified — no audit | no |
 *
 * ## Why a missing field is a refusal rather than a smaller allowance
 *
 * A v4 spending limit with no expiry is not a short mandate; it is a permanent
 * one. A Ryntra-side timer over it is a timer in the party that benefits — the
 * same self-attestation the hub refuses for facilitators — and the moment the
 * process holding it restarts, the on-chain authority is still there. The
 * specification's own words: a wish in the UI is not a cryptographically
 * enforced limit, and where a bypass path exists, Autonomous is not offered.
 *
 * The mirror case is the same defect from the other side. A Subscriptions fixed
 * or recurring delegation binds a *delegatee* — who may pull — and says nothing
 * about where the money goes. An agent holding one can pay itself.
 *
 * ## The second bound, and why it is separate
 *
 * Above the program's bound there is Ryntra's own: the Ledger Agent Intent
 * model the registry row names — up to a limit the agent acts, above it a
 * person confirms. That is deliberately a *different* answer from "a person
 * signs": the mandate is sound, the authority exists, and this one action is
 * simply larger than what was handed over. Collapsing the two would make a
 * routine confirmation look like a broken mandate.
 *
 * Nothing here reads a chain, signs anything or holds a key. Every read is
 * handed in, produced by the modules that own those programs
 * (`lib/solana/allowances`, `lib/solana/treasury`), and an unread field is
 * `UNKNOWN` rather than absent — a read that failed is never a green light.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE_UNITS = /^(?:0|[1-9]\d*)$/;

export const PROGRAM_MANDATE_KINDS = [
  "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT",
  "SUBSCRIPTIONS_MERCHANT_PLAN",
  "SQUADS_V4_SPENDING_LIMIT",
  "SUBSCRIPTIONS_FIXED_DELEGATION",
  "SUBSCRIPTIONS_RECURRING_DELEGATION",
  "BLUESHIFT_PULL_DELEGATION",
] as const;

export type ProgramMandateKind = (typeof PROGRAM_MANDATE_KINDS)[number];

/**
 * The two kinds whose program holds both facts. Everything else needs a
 * person's signature on each action.
 */
export const MANDATE_KINDS_WITH_RECIPIENT_AND_EXPIRY: readonly ProgramMandateKind[] = Object.freeze([
  "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT",
  "SUBSCRIPTIONS_MERCHANT_PLAN",
]);

/** Which of the two facts each insufficient kind is missing. Data, not a branch. */
export const MANDATE_PROGRAM_GAP: Readonly<Record<string, "EXPIRY" | "RECIPIENT" | "AUDIT">> = Object.freeze({
  SQUADS_V4_SPENDING_LIMIT: "EXPIRY",
  SUBSCRIPTIONS_FIXED_DELEGATION: "RECIPIENT",
  SUBSCRIPTIONS_RECURRING_DELEGATION: "RECIPIENT",
  BLUESHIFT_PULL_DELEGATION: "AUDIT",
});

/**
 * Blueshift's Pull Program, and why it is in this file as a refusal.
 *
 * The registry row is one line: no audit, paper and devnet only, never led into
 * the product for people. A program with no audit and no account layout this
 * repository has verified cannot be the thing that replaces a person's
 * signature — on either chain. So the gate refuses it everywhere, and the
 * declaration records where it may be *tried at all*: a paper experiment and
 * devnet, under its own task, where nothing a person owns is at stake.
 *
 * The matching bound on the selling side is `SERVICE_REACH`: a service whose
 * reach is `PAPER_AND_DEVNET_ONLY` refuses on mainnet in the procurement
 * policy, so the two halves of the same rule cannot drift apart.
 */
export const BLUESHIFT_PULL_PROGRAM = Object.freeze({
  id: "BLUESHIFT_PULL_PROGRAM",
  label: "Pull Program (Blueshift)",
  audit: "NONE" as const,
  mayBeTriedOn: Object.freeze(["PAPER", "DEVNET"] as const),
  reachesPeople: false as const,
  source: Object.freeze({
    url: "https://blueshift.gg/",
    observedAt: "2026-10-17",
  }),
  limitations: Object.freeze([
    "No audit is published for it, and this repository has verified none of its account layout.",
    "It is never a mandate that stands in for a person's signature, on devnet or on mainnet.",
    "It reaches no surface a person uses. A paper experiment and devnet are where it may be tried, under its own task.",
  ]),
});

/**
 * Nothing in this repository lifts a program gap.
 *
 * The rule for this task says an agent does not use those three unless the
 * product's owner says so explicitly. A flag that read such a word would be a flag someone can set, and the
 * lifting it is a recorded product decision — so the constant is
 * `false`, there is no reader for an override, and opening one is an edit to
 * this file under a recorded decision rather than configuration.
 */
export const OWNER_WORD_LIFTS_PROGRAM_GAP = false as const;

export const MANDATE_READ_STATES = ["ACTIVE", "REVOKED", "EXPIRED", "UNKNOWN"] as const;

export type MandateReadState = (typeof MANDATE_READ_STATES)[number];

/**
 * One mandate as it was read, with the fields the program actually holds.
 *
 * The shapes differ on purpose. A kind whose program holds no recipient has no
 * `destinations` field to populate, and a kind with no expiry has no
 * `expiresAtMs`. A single wide type with optional fields would let a caller
 * supply the missing one from its own records, which is precisely how a
 * Ryntra-side timer becomes a mandate.
 */
export type ProgramMandateRead =
  | Readonly<{
      kind: "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT";
      state: MandateReadState;
      /** The spending-limit policy account. */
      account: string;
      network: string;
      mint: string;
      /** Who may spend from it — the agent's own key. */
      spender: string;
      /** Where it may pay. The program refuses anything else. */
      destinations: readonly string[];
      /** What the program allows right now, by its own arithmetic. */
      availableBaseUnits: string;
      /** Unix milliseconds. The program holds it; this is not a Ryntra timer. */
      expiresAtMs: number;
    }>
  | Readonly<{
      kind: "SUBSCRIPTIONS_MERCHANT_PLAN";
      state: MandateReadState;
      /** The plan account. */
      account: string;
      network: string;
      mint: string;
      /** Who may pull against the plan. */
      spender: string;
      destinations: readonly string[];
      availableBaseUnits: string;
      /** The plan's last date. `endTs` 0 means none, and that is a refusal. */
      expiresAtMs: number;
    }>
  | Readonly<{
      kind: "SQUADS_V4_SPENDING_LIMIT";
      state: MandateReadState;
      account: string;
      network: string;
      mint: string;
      spender: string;
      destinations: readonly string[];
      availableBaseUnits: string;
      /* No expiry field: Squads v4 has none. */
    }>
  | Readonly<{
      kind: "SUBSCRIPTIONS_FIXED_DELEGATION" | "SUBSCRIPTIONS_RECURRING_DELEGATION";
      state: MandateReadState;
      account: string;
      network: string;
      mint: string;
      /** The delegatee. Not a recipient: the program does not hold one. */
      spender: string;
      availableBaseUnits: string;
      expiresAtMs: number;
      /* No destinations field: these two hold none. */
    }>
  | Readonly<{
      kind: "BLUESHIFT_PULL_DELEGATION";
      state: MandateReadState;
      account: string;
      network: string;
      mint: string;
      spender: string;
      availableBaseUnits: string;
      /* Neither field is claimed: the program has no audit and this repository
         has verified no layout, so stating what it holds would be invention. */
    }>;

export const MANDATE_REFUSALS = [
  "PROGRAM_HOLDS_NO_EXPIRY",
  "PROGRAM_HOLDS_NO_RECIPIENT",
  "PROGRAM_NOT_AUDITED",
  "MANDATE_READ_UNKNOWN",
  "MANDATE_NOT_ACTIVE",
  "MANDATE_NETWORK_MISMATCH",
  "MANDATE_MINT_MISMATCH",
  "MANDATE_SPENDER_MISMATCH",
  "MANDATE_RECIPIENT_LIST_EMPTY",
  "MANDATE_RECIPIENT_NOT_LISTED",
  "MANDATE_EXPIRY_ABSENT",
  "MANDATE_EXPIRY_PASSED",
  "MANDATE_AMOUNT_ABOVE_AVAILABLE",
  "MANDATE_FIELDS_MALFORMED",
  "AMOUNT_ABOVE_AGENT_BOUND",
] as const;

export type MandateRefusal = (typeof MANDATE_REFUSALS)[number];

/** What the hub is being asked to authorize. All amounts in base units. */
export type MandateRequest = Readonly<{
  network: string;
  mint: string;
  payTo: string;
  amountBaseUnits: string;
  /** The agent's spending key, as the program would see it. */
  spender: string;
  /**
   * Ryntra's own bound for this agent, in the same base units. Above it a
   * person confirms this action; the mandate is unaffected.
   */
  agentBoundBaseUnits: string;
}>;

export type MandateDecision =
  | Readonly<{
      authorization: "AGENT_ALONE";
      enforcement: "PROGRAM_ENFORCED";
      kind: ProgramMandateKind;
      account: string;
      /** What the program holds, named so the surface can show it. */
      holds: readonly ["RECIPIENT", "EXPIRY"];
      expiresAtMs: number;
      availableBaseUnits: string;
    }>
  | Readonly<{
      authorization: "HUMAN_CONFIRMATION";
      enforcement: "PROGRAM_ENFORCED";
      kind: ProgramMandateKind;
      account: string;
      reasonCode: "AMOUNT_ABOVE_AGENT_BOUND";
      detail: string;
    }>
  | Readonly<{
      authorization: "HUMAN_SIGNATURE";
      enforcement: "NOT_PROGRAM_ENFORCED";
      kind: ProgramMandateKind;
      reasonCode: MandateRefusal;
      detail: string;
    }>;

function amountsReadable(...values: readonly string[]): boolean {
  return values.every((value) => typeof value === "string" && BASE_UNITS.test(value));
}

/**
 * Decide, for one request, whether the agent may act alone.
 *
 * The order is load-bearing and it is the opposite of convenient. The program
 * gap is checked **first**, before the state, the network, the mint or the
 * amount — because a mandate the program cannot bound is not improved by being
 * active, on the right chain, in the right token or small. Reporting it as
 * "expired" or "too large" would invite a caller to fix the wrong thing and
 * arrive back here with the same unbounded authority.
 */
export function evaluateProgramMandate({
  read,
  request,
  nowMs,
}: {
  read: ProgramMandateRead;
  request: MandateRequest;
  nowMs: number;
}): MandateDecision {
  const signature = (reasonCode: MandateRefusal, detail: string): MandateDecision =>
    Object.freeze({
      authorization: "HUMAN_SIGNATURE" as const,
      enforcement: "NOT_PROGRAM_ENFORCED" as const,
      kind: read.kind,
      reasonCode,
      detail,
    });

  /* 1. Does the program hold both facts at all? */
  const gap = MANDATE_PROGRAM_GAP[read.kind];
  if (gap === "EXPIRY") {
    return signature(
      "PROGRAM_HOLDS_NO_EXPIRY",
      "a Squads v4 spending limit has no expiry in the program, so nothing on chain ends it; a Ryntra-side timer is not a bound",
    );
  }
  if (gap === "RECIPIENT") {
    return signature(
      "PROGRAM_HOLDS_NO_RECIPIENT",
      "a Subscriptions fixed or recurring delegation binds who may pull and not where the money goes, so the agent could pay itself",
    );
  }
  if (gap === "AUDIT") {
    return signature(
      "PROGRAM_NOT_AUDITED",
      `${BLUESHIFT_PULL_PROGRAM.label} has no published audit and no account layout verified here; a paper experiment and devnet are where it may be tried, never in place of a signature`,
    );
  }
  if (!MANDATE_KINDS_WITH_RECIPIENT_AND_EXPIRY.includes(read.kind)) {
    /* Unreachable while the two lists above agree, and kept so that a sixth
       kind added to the union without a row in either list fails closed rather
       than falling through to the checks below. */
    return signature("PROGRAM_HOLDS_NO_EXPIRY", `${read.kind} declares neither fact to this gate`);
  }

  /* From here the kind is one of the two sound ones, so both fields exist. */
  const sound = read as Extract<
    ProgramMandateRead,
    { kind: "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT" | "SUBSCRIPTIONS_MERCHANT_PLAN" }
  >;

  /* 2. Was it read, and is it live? */
  if (sound.state === "UNKNOWN") {
    return signature(
      "MANDATE_READ_UNKNOWN",
      "the policy, its token approval or its plan could not be read; unknown is never active",
    );
  }
  if (sound.state !== "ACTIVE") {
    return signature("MANDATE_NOT_ACTIVE", `the mandate reads ${sound.state}`);
  }

  /* 3. Is it the same chain, the same token and the same spender? */
  if (sound.network !== request.network) {
    return signature(
      "MANDATE_NETWORK_MISMATCH",
      `the mandate is on ${sound.network} and the payment would be on ${request.network}`,
    );
  }
  if (sound.mint !== request.mint) {
    return signature(
      "MANDATE_MINT_MISMATCH",
      `the mandate is for mint ${sound.mint} and the payment is in ${request.mint}`,
    );
  }
  if (!BASE58.test(request.spender) || sound.spender !== request.spender) {
    return signature(
      "MANDATE_SPENDER_MISMATCH",
      `the mandate names ${sound.spender} and the request would be spent by ${request.spender}`,
    );
  }

  /* 4. The recipient, from the program's own list. An empty list is a refusal
        rather than "anywhere": Squads reads an empty destination list as
        unrestricted, which is the one reading this gate must never inherit. */
  if (sound.destinations.length === 0) {
    return signature(
      "MANDATE_RECIPIENT_LIST_EMPTY",
      "an empty destination list means anywhere, and anywhere is not a mandate",
    );
  }
  if (!BASE58.test(request.payTo) || !sound.destinations.includes(request.payTo)) {
    return signature(
      "MANDATE_RECIPIENT_NOT_LISTED",
      `${request.payTo} is not one of the ${sound.destinations.length} recipients the program holds`,
    );
  }

  /* 5. The end date, also from the program. */
  if (!Number.isFinite(sound.expiresAtMs) || sound.expiresAtMs <= 0) {
    return signature(
      "MANDATE_EXPIRY_ABSENT",
      "the program holds no last date for this mandate; a plan that never ends charges until somebody cancels",
    );
  }
  if (sound.expiresAtMs <= nowMs) {
    return signature(
      "MANDATE_EXPIRY_PASSED",
      `the mandate ended at ${new Date(sound.expiresAtMs).toISOString()}`,
    );
  }

  /* 6. The amounts. */
  if (!amountsReadable(sound.availableBaseUnits, request.amountBaseUnits, request.agentBoundBaseUnits)) {
    return signature(
      "MANDATE_FIELDS_MALFORMED",
      "amounts are whole base units as digits; a decimal display string is not one",
    );
  }
  const amount = BigInt(request.amountBaseUnits);
  if (amount <= 0n) {
    return signature("MANDATE_FIELDS_MALFORMED", "a payment of nothing is not a payment");
  }
  if (amount > BigInt(sound.availableBaseUnits)) {
    return signature(
      "MANDATE_AMOUNT_ABOVE_AVAILABLE",
      `the program allows ${sound.availableBaseUnits} right now and the payment is ${request.amountBaseUnits}`,
    );
  }

  /* 7. Ryntra's own bound. The mandate is sound; this action is simply larger
        than what was handed over, so a person confirms this one. */
  if (amount > BigInt(request.agentBoundBaseUnits)) {
    return Object.freeze({
      authorization: "HUMAN_CONFIRMATION" as const,
      enforcement: "PROGRAM_ENFORCED" as const,
      kind: sound.kind,
      account: sound.account,
      reasonCode: "AMOUNT_ABOVE_AGENT_BOUND" as const,
      detail: `the agent acts alone up to ${request.agentBoundBaseUnits} and this payment is ${request.amountBaseUnits}`,
    });
  }

  return Object.freeze({
    authorization: "AGENT_ALONE" as const,
    enforcement: "PROGRAM_ENFORCED" as const,
    kind: sound.kind,
    account: sound.account,
    holds: Object.freeze(["RECIPIENT", "EXPIRY"] as const),
    expiresAtMs: sound.expiresAtMs,
    availableBaseUnits: sound.availableBaseUnits,
  });
}
