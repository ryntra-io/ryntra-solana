/**
 * What an agent that is not Ryntra's may do here, and what it costs.
 *
 * Three runtimes reach this product today — an MCP client, ElizaOS, the Solana
 * Agent Kit — and the question each of them arrives with is the same one: what
 * does a trade through Ryntra cost, and may I place it. This module answers the
 * first exactly, from the one fee table the product's own order reads, and
 * answers the second with a no that has a reason attached.
 *
 * ## Reads and quotes, and no third thing
 *
 * `EXTERNAL_AGENT_CAPABILITIES` is a union of two values, and `EXECUTE` is not
 * one of them — the same device `../mcp/write-tools.ts` uses for its one effect
 * value. A caller cannot ask this module to execute, not because a branch
 * refuses but because there is no value for the request to carry. The refusal a
 * caller does see, `INTENT_KIND_NOT_SERVED`, is for a *named* intent this
 * surface does not serve, which is a different sentence from "that is
 * forbidden": it says nobody gets it here, rather than suggesting somebody
 * else might.
 *
 * ## A quote is a price, not a transaction
 *
 * Nothing here builds, simulates, signs or sends anything, and no field in a
 * quotation could carry bytes. What a quotation holds is the fee the product's
 * own policy puts on the pair, the lane that fee travels by, which side of the
 * pair it comes out of, and — where it can be computed exactly — the amount, by
 * the same integer arithmetic the signable path uses. A reader comparing a
 * quotation against the Review a person later signs should find the same
 * number, because it came from the same table and the same function.
 *
 * ## An unread side is never a guess at a higher fee
 *
 * The fee policy's own rule, restated at this edge because an external caller
 * is the one most likely to hand over a mint nobody can read: a side whose
 * facts are missing makes the pair `AS_NOW` — the lane production ran before
 * the policy — rather than the most expensive flow in the table. Quoting
 * upwards on missing information would be charging for our own ignorance.
 *
 * ## The two reasons an action does not happen here
 *
 * They are independent and both are reported. The first is that a request from
 * outside never carries the wallet owner's signature, and a trade that moves a
 * person's money needs one. The second is whether a spending mandate a program
 * actually holds exists at all, which `../procurement/mandate.ts` decides and
 * this module does not re-derive. A sound mandate does not remove the first
 * reason, and a missing signature does not excuse not reporting the second —
 * collapsing them would let "a person must sign" hide an exhausted mandate, and
 * the next release would open the signature path onto an authority that was
 * never there.
 *
 * Pure: no clock unless given, no network, no `process.env`, no key.
 */

import {
  FEE_FLOWS,
  FEE_POLICY_V2,
  buildFeeSide,
  classifyPair,
  classifySide,
  inputSideFeeRaw,
  productOfFlow,
  type FeeFlow,
  type SideFacts,
} from "../../core/fee-policy.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS } from "../../core/venues/meteora-dbc/presets.ts";
import { presetTerms } from "../../core/launch/preset-terms.ts";
import {
  evaluateProgramMandate,
  type MandateDecision,
  type MandateRequest,
  type ProgramMandateRead,
} from "../procurement/mandate.ts";

/**
 * Everything an agent from outside may do through this router.
 *
 * Two members. A third would be a product decision, and the test that pins the
 * length says so.
 */
export const EXTERNAL_AGENT_CAPABILITIES = ["READ", "QUOTE"] as const;

export type ExternalAgentCapability = (typeof EXTERNAL_AGENT_CAPABILITIES)[number];

/** The intents this surface serves. Each one is a read or a price. */
export const ROUTER_INTENT_KINDS = ["READ_TARIFF", "QUOTE_TRADE", "QUOTE_LAUNCH_BUY"] as const;

export type RouterIntentKind = (typeof ROUTER_INTENT_KINDS)[number];

export const ROUTER_REFUSALS = [
  "INTENT_KIND_NOT_SERVED",
  "INTENT_MALFORMED",
  "MINTS_IDENTICAL",
  "AMOUNT_MALFORMED",
  "SIDE_FACTS_NOT_FOR_THIS_MINT",
  "LAUNCH_PRESET_UNKNOWN",
  "LAUNCH_PRESET_NOT_OPEN_TO_PEOPLE",
] as const;

export type RouterRefusal = (typeof ROUTER_REFUSALS)[number];

export class RouterError extends Error {
  readonly reasonCode: RouterRefusal;

  constructor(reasonCode: RouterRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "RouterError";
    this.reasonCode = reasonCode;
  }
}

/* ── who arrives, and by which door ────────────────────────────────────── */

export type ExternalRuntime = Readonly<{
  id: string;
  label: string;
  /** The protocol it speaks to Ryntra. */
  speaks: "MCP" | "A2A" | "HTTP";
  /** The address it reaches, relative to the deployment's origin. */
  reaches: readonly string[];
  capabilities: readonly ExternalAgentCapability[];
  limitations: readonly string[];
}>;

/**
 * The three runtimes, as documentation of which door each comes through.
 *
 * Deliberately **not** an admission list. Admission is the agent key and its
 * scopes, which are per key and enforced by the route gate; a runtime named
 * here gets nothing a runtime absent from it lacks. Writing it as an allowlist
 * would be the defect the hosted MCP endpoint already names — a list of names
 * that one indirection defeats — dressed as a control.
 */
export const EXTERNAL_RUNTIMES: readonly ExternalRuntime[] = Object.freeze([
  Object.freeze({
    id: "mcp-client",
    label: "Any MCP client",
    speaks: "MCP" as const,
    reaches: Object.freeze(["/api/agents/mcp"]),
    capabilities: Object.freeze(["READ" as const]),
    limitations: Object.freeze([
      "The hosted inventory is the three local reads and the five proposal tools. Nothing in it reaches a provider on the caller's behalf.",
      "A proposal waits for a person. No tool call advances a record past PROPOSE.",
    ]),
  }),
  Object.freeze({
    id: "eliza-os",
    label: "ElizaOS",
    speaks: "A2A" as const,
    reaches: Object.freeze(["/.well-known/agent-card.json", "/api/agents/a2a"]),
    capabilities: Object.freeze(["READ" as const, "QUOTE" as const]),
    limitations: Object.freeze([
      "One method is served, message:send, and it answers a read or a quote. Streaming, cancellation, subscription and push configs are refused by name.",
      "A request that would act ends as a rejected task, never as a task waiting for a credential.",
    ]),
  }),
  Object.freeze({
    id: "solana-agent-kit",
    label: "Solana Agent Kit",
    speaks: "HTTP" as const,
    reaches: Object.freeze(["/api/agents/router", "/api/agents/services"]),
    capabilities: Object.freeze(["READ" as const, "QUOTE" as const]),
    limitations: Object.freeze([
      "The router answers the tariff and a fee quotation. It returns no transaction, no instruction and no account to sign.",
      "A paid service is bought over x402 at its own address, under its own quote.",
    ]),
  }),
]);

/* ── the skills the card publishes for this surface ────────────────────── */

export type RouterSkill = Readonly<{
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  examples: readonly string[];
  intent: RouterIntentKind;
}>;

export const EXTERNAL_ROUTER_SKILLS: readonly RouterSkill[] = Object.freeze([
  Object.freeze({
    id: "read_fee_tariff",
    name: "Read the fee tariff",
    description:
      "Return Ryntra's fee for every flow it names, the lane each fee travels by, and the curve fees of the launch presets open to people. A read of this product's own table; no price of any asset is involved.",
    tags: Object.freeze(["read", "fee", "tariff"]),
    examples: Object.freeze(["What does Ryntra charge on a meme trade?"]),
    intent: "READ_TARIFF" as const,
  }),
  Object.freeze({
    id: "quote_trade_fee",
    name: "Quote the fee on a trade",
    description:
      "Classify a pair, name the flow, and return Ryntra's fee on it — the rate, the lane, the side the fee comes from and, where it is exact before a signature, the amount. Returns no transaction and no route.",
    tags: Object.freeze(["quote", "fee", "spot", "memes"]),
    examples: Object.freeze(["Quote the Ryntra fee on 100 USDC into this mint."]),
    intent: "QUOTE_TRADE" as const,
  }),
  Object.freeze({
    id: "quote_launch_fee",
    name: "Quote the fees of a launch",
    description:
      "Return one launch preset's terms as the creator agreed them: the curve's fee over its first window, the base fee after it, and how every fee is split when the trade comes through Ryntra.",
    tags: Object.freeze(["quote", "fee", "launch"]),
    examples: Object.freeze(["What are the fees on a Micro launch?"]),
    intent: "QUOTE_LAUNCH_BUY" as const,
  }),
]);

/* ── what the router will not do, as one record ────────────────────────── */

/**
 * The execution answer, and it has one value.
 *
 * A union of one for the same reason the write effect is: a second value is
 * what a later release would need in order to open execution, and adding it is
 * a decision somebody makes on purpose rather than a field somebody fills in.
 */
export const EXTERNAL_EXECUTION_STATES = ["OWNER_SIGNATURE_REQUIRED"] as const;

export type ExternalExecutionState = (typeof EXTERNAL_EXECUTION_STATES)[number];

export const EXTERNAL_EXECUTION_CLOSED = Object.freeze({
  open: false as const,
  state: "OWNER_SIGNATURE_REQUIRED" as const,
  requires: Object.freeze([
    "A spending mandate whose program holds both the recipient and the end date.",
    "The wallet owner's signature on the action itself, at the time of the action.",
  ]),
  because: Object.freeze([
    "A request arriving from another agent system carries no signature of the wallet's owner, and no credential presented to this surface is one.",
    "Reads and quotes are what this release opened. Execution for an agent that is not Ryntra's is a later, separately opened step.",
  ]),
});

/* ── the tariff ────────────────────────────────────────────────────────── */

export type TariffRow = Readonly<{
  flow: FeeFlow;
  bps: number;
  lane: "BUILD" | "ORDER";
  orderMayWin: boolean;
  /** Which fee wallet's figures this flow belongs to. */
  product: "swap" | "memes" | "stocks";
}>;

export type LaunchTariffRow = Readonly<{
  presetId: string;
  label: string;
  curveFirstWindowStartBps: number;
  curveFirstWindowEndBps: number;
  curveFirstWindowSeconds: number;
  curveBaseFeeBps: number;
  curveDynamicFee: boolean;
  /** Of every fee a trade on the curve pays, when the trade comes through Ryntra. */
  splitThroughRyntra: Readonly<{ creatorBps: number; ryntraBps: number; meteoraBps: number }>;
  graduationFeeBps: number;
}>;

export type Tariff = Readonly<{
  policyVersion: string;
  flows: readonly TariffRow[];
  launches: readonly LaunchTariffRow[];
  howAFlowIsDecided: readonly string[];
  limitations: readonly string[];
}>;

const HOW_A_FLOW_IS_DECIDED = Object.freeze([
  "A side is a dollar, a major, a stock by its issuer's tag, or a token.",
  "A token a catalogue verifies whose first pool is at least seven days old is trending; otherwise it is a meme.",
  "The pair takes the side that is not money: a stock decides first, then the riskier of two tokens.",
  "A side whose facts could not be read makes the pair AS_NOW — the lane production ran before this policy — never a guess at a higher fee.",
]);

/** The whole table, as a read. */
export function readTariff(): Tariff {
  const flows = FEE_FLOWS.map((flow): TariffRow => {
    const rule = FEE_POLICY_V2[flow];
    return Object.freeze({
      flow,
      bps: rule.bps,
      lane: rule.lane,
      orderMayWin: rule.orderMayWin,
      product: productOfFlow(flow),
    });
  });

  const launches = PEOPLE_PRESET_IDS.map((presetId): LaunchTariffRow | null => {
    const terms = presetTerms(presetId);
    if (!terms) return null;
    return Object.freeze({
      presetId,
      label: LAUNCH_PRESETS[presetId].name.en,
      curveFirstWindowStartBps: terms.curve.sniperFee.startBps,
      curveFirstWindowEndBps: terms.curve.sniperFee.endBps,
      curveFirstWindowSeconds: terms.curve.sniperFee.seconds,
      curveBaseFeeBps: terms.curve.baseFeeBps,
      curveDynamicFee: terms.curve.dynamicFee,
      splitThroughRyntra: Object.freeze({ ...terms.curve.splitThroughRyntra }),
      graduationFeeBps: terms.graduation.feeBps,
    });
  }).filter((row): row is LaunchTariffRow => row !== null);

  return Object.freeze({
    policyVersion: "2.0.0",
    flows: Object.freeze(flows),
    launches: Object.freeze(launches),
    howAFlowIsDecided: HOW_A_FLOW_IS_DECIDED,
    limitations: Object.freeze([
      "A rate is Ryntra's own fee. The venue's own fee, the network's fee and the price of the asset are not in it.",
      "On the order lane Ryntra's fee is asked for as a referral, and the venue refuses a referral below its own minimum — then the trade carries no Ryntra fee at all.",
      "The launch rows are the terms of the presets open to people. A preset that is not open to people is not quoted here.",
    ]),
  });
}

/* ── one trade's fee ──────────────────────────────────────────────────── */

const RAW_AMOUNT = /^(?:0|[1-9]\d*)$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type TradeQuoteRequest = Readonly<{
  inputMint: string;
  outputMint: string;
  /** Whole base units of the input mint, as digits. */
  amountRaw: string;
  /** What a catalogue said of each side, or null when it could not say. */
  input: SideFacts | null;
  output: SideFacts | null;
  nowMs: number;
}>;

export type TradeQuotation = Readonly<{
  kind: "EXTERNAL_FEE_QUOTATION";
  capability: "QUOTE";
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  flow: FeeFlow;
  inputClass: string;
  outputClass: string;
  feeBps: number;
  lane: "BUILD" | "ORDER";
  orderMayWin: boolean;
  product: "swap" | "memes" | "stocks";
  /** Which side of the pair the fee comes out of on the build lane, or null. */
  feeSide: Readonly<{ side: "INPUT" | "OUTPUT"; mint: string }> | null;
  /**
   * The fee in whole base units, when it is exact before any route is asked:
   * the build lane taking its share of the amount the caller named. Null —
   * with a reason — whenever the number would depend on a route nobody asked
   * for.
   */
  feeRaw: string | null;
  feeRawUnknownBecause: string | null;
  /** What the router will not do, whatever this quotation says. */
  execution: typeof EXTERNAL_EXECUTION_CLOSED;
  /** Transaction bytes. Always nothing: there is no value this could take. */
  transaction: null;
  limitations: readonly string[];
}>;

const QUOTATION_LIMITATIONS = Object.freeze([
  "A fee rate, not a price. What the trade returns depends on a route this quotation did not ask for.",
  "Nothing here is signable. No instruction, no account and no transaction is built.",
  "The rate is the one the product's own order reads, so a Review a person later signs shows the same number.",
]);

/**
 * Quote the Ryntra fee on one pair.
 *
 * The checks run before the classification, and the order is the usual one:
 * a malformed request is reported as malformed rather than as an expensive
 * flow. Identical mints are refused rather than priced, because a pair of one
 * token is not a trade and the fee table has no row for it.
 */
export function quoteTradeFee(request: TradeQuoteRequest): TradeQuotation {
  if (!BASE58.test(request.inputMint) || !BASE58.test(request.outputMint)) {
    throw new RouterError("INTENT_MALFORMED", "a mint is a base-58 address of the usual length");
  }
  if (request.inputMint === request.outputMint) {
    throw new RouterError("MINTS_IDENTICAL", "a pair of one token is not a trade, and the table has no row for it");
  }
  if (!RAW_AMOUNT.test(request.amountRaw) || BigInt(request.amountRaw) === 0n) {
    throw new RouterError(
      "AMOUNT_MALFORMED",
      "an amount is whole base units as digits, above zero; a decimal display string is not one",
    );
  }
  /* A caller handing over facts for a different mint is refused rather than
     quoted with them ignored. `classifySide` would read the mismatch as
     unreadable and answer AS_NOW, which is the right answer to missing facts
     and the wrong answer to facts about something else. */
  for (const [side, facts, mint] of [
    ["input", request.input, request.inputMint],
    ["output", request.output, request.outputMint],
  ] as const) {
    if (facts !== null && facts.mint !== mint) {
      throw new RouterError(
        "SIDE_FACTS_NOT_FOR_THIS_MINT",
        `the ${side} facts describe ${facts.mint} and the ${side} of this pair is ${mint}`,
      );
    }
  }

  const inputClass = classifySide(request.inputMint, request.input, request.nowMs);
  const outputClass = classifySide(request.outputMint, request.output, request.nowMs);
  const flow = classifyPair({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    input: request.input,
    output: request.output,
    nowMs: request.nowMs,
  });
  const rule = FEE_POLICY_V2[flow];
  const feeSide = rule.lane === "BUILD" ? buildFeeSide(request.inputMint, request.outputMint) : null;

  let feeRaw: string | null = null;
  let unknownBecause: string | null = null;
  if (rule.bps <= 0) {
    feeRaw = "0";
  } else if (rule.lane !== "BUILD") {
    unknownBecause = "this flow travels by the order lane, where the fee is a referral share of what the trade returns.";
  } else if (feeSide === null) {
    unknownBecause = "neither side is a mint the fee wallet takes, so the build lane carries no fee for this pair.";
  } else if (feeSide.side === "INPUT") {
    feeRaw = inputSideFeeRaw(request.amountRaw, rule.bps);
  } else {
    unknownBecause = "the fee comes out of the output side, which is not known without a route.";
  }

  return Object.freeze({
    kind: "EXTERNAL_FEE_QUOTATION" as const,
    capability: "QUOTE" as const,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amountRaw: request.amountRaw,
    flow,
    inputClass,
    outputClass,
    feeBps: rule.bps,
    lane: rule.lane,
    orderMayWin: rule.orderMayWin,
    product: productOfFlow(flow),
    feeSide: feeSide ? Object.freeze({ ...feeSide }) : null,
    feeRaw,
    feeRawUnknownBecause: unknownBecause,
    execution: EXTERNAL_EXECUTION_CLOSED,
    transaction: null,
    limitations: QUOTATION_LIMITATIONS,
  });
}

/* ── one launch's fees ────────────────────────────────────────────────── */

export type LaunchQuotation = Readonly<{
  kind: "EXTERNAL_LAUNCH_FEE_QUOTATION";
  capability: "QUOTE";
  terms: LaunchTariffRow;
  execution: typeof EXTERNAL_EXECUTION_CLOSED;
  transaction: null;
  limitations: readonly string[];
}>;

/**
 * Quote one launch preset's fees.
 *
 * A preset that is not open to people is refused rather than quoted. Quoting it
 * would publish the terms of something a person cannot buy, and a reader would
 * reasonably conclude they could.
 */
export function quoteLaunchFee(presetId: string): LaunchQuotation {
  const tariff = readTariff();
  const row = tariff.launches.find((entry) => entry.presetId === presetId);
  if (!row) {
    const known = Object.keys(LAUNCH_PRESETS).includes(presetId);
    throw new RouterError(
      known ? "LAUNCH_PRESET_NOT_OPEN_TO_PEOPLE" : "LAUNCH_PRESET_UNKNOWN",
      known
        ? `${presetId} is not a preset a person can launch on, so its terms are not quoted`
        : "no preset of that name exists",
    );
  }
  return Object.freeze({
    kind: "EXTERNAL_LAUNCH_FEE_QUOTATION" as const,
    capability: "QUOTE" as const,
    terms: row,
    execution: EXTERNAL_EXECUTION_CLOSED,
    transaction: null,
    limitations: Object.freeze([
      "The split is of every fee a trade on the curve pays, with the venue's own part already taken out.",
      "The first window's rate falls from its start to its end over its seconds; a trade inside it pays more than the base fee.",
      ...QUOTATION_LIMITATIONS,
    ]),
  });
}

/* ── what it would take to act ────────────────────────────────────────── */

export const EXTERNAL_EXECUTION_REASONS = [
  "EXTERNAL_REQUEST_CARRIES_NO_OWNER_SIGNATURE",
  "MANDATE_NOT_SOUND",
] as const;

export type ExternalExecutionReason = (typeof EXTERNAL_EXECUTION_REASONS)[number];

export type ExternalExecutionDecision = Readonly<{
  state: ExternalExecutionState;
  /** Both reasons when both apply; the first one always applies. */
  reasons: readonly ExternalExecutionReason[];
  /**
   * What the mandate gate said about the program's own bound, recorded whole.
   *
   * Kept even when the signature requirement already settles the answer: an
   * exhausted or absent mandate is a different defect from a missing signature,
   * and a surface that showed only the signature would be hiding it.
   */
  programVerdict: MandateDecision;
  mandateSound: boolean;
  limitations: readonly string[];
}>;

/**
 * Decide what it would take for one external request to become an action.
 *
 * The answer is always the same state, and that is the point of running the
 * mandate gate anyway: the gate's verdict is the second fact, and it is the one
 * that changes. A caller that fixes the mandate still gets
 * `OWNER_SIGNATURE_REQUIRED`; a caller that somehow arrived with a signature
 * would still be short a mandate the program holds.
 */
export function decideExternalExecution({
  read,
  request,
  nowMs,
}: {
  read: ProgramMandateRead;
  request: MandateRequest;
  nowMs: number;
}): ExternalExecutionDecision {
  const programVerdict = evaluateProgramMandate({ read, request, nowMs });
  const mandateSound = programVerdict.authorization === "AGENT_ALONE";
  const reasons: ExternalExecutionReason[] = ["EXTERNAL_REQUEST_CARRIES_NO_OWNER_SIGNATURE"];
  if (!mandateSound) reasons.push("MANDATE_NOT_SOUND");

  return Object.freeze({
    state: "OWNER_SIGNATURE_REQUIRED" as const,
    reasons: Object.freeze(reasons),
    programVerdict,
    mandateSound,
    limitations: Object.freeze([
      "A sound mandate lets one of Ryntra's own agents spend inside the bound its program holds. It is not permission for another agent system to move a person's money.",
      "The signature is the wallet owner's, on the action, at the time of the action. No credential presented to this surface is one.",
    ]),
  });
}
