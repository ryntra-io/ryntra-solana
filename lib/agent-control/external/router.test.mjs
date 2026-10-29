// Run from repo root: node --test lib/agent-control/external/router.test.mjs
//
// What an agent from outside may ask for, what it costs, and the two reasons
// it cannot act.
//
// The rates are not restated here. Every expectation about a fee reads the one
// table the product's own order reads, so a test that passed while the table
// changed underneath it would be a test of nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOLLAR_MINTS,
  FEE_POLICY_V2,
  USDT_MINT,
  inputSideFeeRaw,
} from "../../core/fee-policy.ts";
import { PEOPLE_PRESET_IDS } from "../../core/venues/meteora-dbc/presets.ts";
import { presetTerms } from "../../core/launch/preset-terms.ts";
import { FIXTURE, MAINNET, USDC_MAINNET, smartAccountLimit } from "../procurement/fixtures.ts";
import {
  EXTERNAL_AGENT_CAPABILITIES,
  EXTERNAL_EXECUTION_CLOSED,
  EXTERNAL_EXECUTION_STATES,
  EXTERNAL_ROUTER_SKILLS,
  EXTERNAL_RUNTIMES,
  ROUTER_INTENT_KINDS,
  RouterError,
  decideExternalExecution,
  quoteLaunchFee,
  quoteTradeFee,
  readTariff,
} from "./router.ts";
import { FIXTURE_MINTS, memeFacts, stockFacts, trendingFacts } from "./fixtures.ts";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const AMOUNT = "123456789";

function quote(overrides = {}) {
  return quoteTradeFee({
    inputMint: FIXTURE_MINTS.usdc,
    outputMint: FIXTURE_MINTS.freshToken,
    amountRaw: AMOUNT,
    input: null,
    output: memeFacts(),
    nowMs: NOW,
    ...overrides,
  });
}

test("there is no capability for acting, so no request can carry one", () => {
  /* The property, not a branch: a third member is what a later release would
     need, and adding it is a decision rather than a field somebody fills in. */
  assert.deepEqual([...EXTERNAL_AGENT_CAPABILITIES], ["READ", "QUOTE"]);
  assert.ok(!EXTERNAL_AGENT_CAPABILITIES.includes("EXECUTE"));
  assert.deepEqual([...EXTERNAL_EXECUTION_STATES], ["OWNER_SIGNATURE_REQUIRED"]);
  assert.equal(EXTERNAL_EXECUTION_CLOSED.open, false);
});

test("the runtimes are documentation of doors, not an admission list", () => {
  assert.ok(EXTERNAL_RUNTIMES.length >= 3);
  for (const runtime of EXTERNAL_RUNTIMES) {
    assert.ok(runtime.reaches.length > 0, `${runtime.id} reaches nothing`);
    for (const capability of runtime.capabilities) {
      assert.ok(
        EXTERNAL_AGENT_CAPABILITIES.includes(capability),
        `${runtime.id} declares ${capability}, which is not a capability of this surface`,
      );
    }
    assert.ok(runtime.limitations.length > 0, `${runtime.id} states no limitation`);
  }
});

test("every published skill resolves to an intent this surface serves", () => {
  for (const skill of EXTERNAL_ROUTER_SKILLS) {
    assert.ok(ROUTER_INTENT_KINDS.includes(skill.intent), `${skill.id} names an intent nobody serves`);
    assert.doesNotMatch(
      `${skill.id} ${skill.name} ${skill.description}`,
      /\b(sign|execute|submit|withdraw|transfer)\b/i,
      `${skill.id} is described with a verb this surface cannot perform`,
    );
  }
});

test("the tariff is the table, flow for flow", () => {
  const tariff = readTariff();
  for (const row of tariff.flows) {
    assert.equal(row.bps, FEE_POLICY_V2[row.flow].bps, row.flow);
    assert.equal(row.lane, FEE_POLICY_V2[row.flow].lane, row.flow);
  }
  assert.equal(tariff.flows.length, Object.keys(FEE_POLICY_V2).length);
  assert.ok(tariff.howAFlowIsDecided.some((line) => /never a guess at a higher fee/i.test(line)));
});

test("the tariff quotes the launch presets a person can launch on, and no others", () => {
  const tariff = readTariff();
  assert.deepEqual(
    tariff.launches.map((row) => row.presetId).sort(),
    [...PEOPLE_PRESET_IDS].sort(),
  );
  for (const row of tariff.launches) {
    const terms = presetTerms(row.presetId);
    assert.equal(row.curveBaseFeeBps, terms.curve.baseFeeBps, row.presetId);
    assert.deepEqual(row.splitThroughRyntra, { ...terms.curve.splitThroughRyntra }, row.presetId);
  }
});

test("a token nobody verified is a meme, and the fee off the input side is exact", () => {
  const quotation = quote();
  assert.equal(quotation.flow, "MEME");
  assert.equal(quotation.feeBps, FEE_POLICY_V2.MEME.bps);
  assert.equal(quotation.lane, "BUILD");
  assert.deepEqual(quotation.feeSide, { side: "INPUT", mint: FIXTURE_MINTS.usdc });
  assert.equal(quotation.feeRaw, inputSideFeeRaw(AMOUNT, FEE_POLICY_V2.MEME.bps));
  assert.equal(quotation.feeRawUnknownBecause, null);
  assert.equal(quotation.transaction, null);
  assert.equal(quotation.execution.open, false);
});

test("an unread side takes the lane production ran before the policy, never the dearest flow", () => {
  /*
   * The case an external caller produces most often: a mint this product has
   * never heard of. Quoting MEME for it would be charging a per cent for our
   * own ignorance, which is the defect the fee policy names in its own words.
   */
  const quotation = quote({ output: null, outputMint: FIXTURE_MINTS.oldToken });
  assert.equal(quotation.flow, "AS_NOW");
  assert.equal(quotation.feeBps, FEE_POLICY_V2.AS_NOW.bps);
  assert.ok(quotation.feeBps < FEE_POLICY_V2.MEME.bps);
});

test("facts about another mint are refused rather than quietly ignored", () => {
  /* `classifySide` reads a mismatch as unreadable, which is the right answer to
     missing facts and the wrong answer to facts about something else: the
     caller would get an AS_NOW quote and believe its own numbers were used. */
  assert.throws(
    () => quote({ output: memeFacts(FIXTURE_MINTS.oldToken) }),
    (error) => error instanceof RouterError && error.reasonCode === "SIDE_FACTS_NOT_FOR_THIS_MINT",
  );
});

test("a pair of one token, a bad amount and a bad mint each refuse by their own name", () => {
  assert.throws(
    () => quote({ outputMint: FIXTURE_MINTS.usdc }),
    (error) => error.reasonCode === "MINTS_IDENTICAL",
  );
  for (const amountRaw of ["0", "-1", "1.5", "1e9", "", "0x10"]) {
    assert.throws(
      () => quote({ amountRaw }),
      (error) => error.reasonCode === "AMOUNT_MALFORMED",
      amountRaw,
    );
  }
  assert.throws(
    () => quote({ inputMint: "not-an-address" }),
    (error) => error.reasonCode === "INTENT_MALFORMED",
  );
});

test("two dollars pay nothing, and nothing is quoted as exactly nothing", () => {
  assert.ok(DOLLAR_MINTS.has(USDT_MINT));
  const quotation = quote({ outputMint: USDT_MINT, output: null });
  assert.equal(quotation.flow, "STABLE");
  assert.equal(quotation.feeBps, 0);
  assert.equal(quotation.feeRaw, "0");
});

test("a fee that would come out of the output, or out of neither side, says so instead of guessing", () => {
  const fromOutput = quote({
    inputMint: FIXTURE_MINTS.freshToken,
    input: memeFacts(),
    outputMint: FIXTURE_MINTS.usdc,
    output: null,
  });
  assert.equal(fromOutput.feeSide.side, "OUTPUT");
  assert.equal(fromOutput.feeRaw, null);
  assert.match(fromOutput.feeRawUnknownBecause, /output side/);

  const fromNeither = quote({
    inputMint: FIXTURE_MINTS.freshToken,
    input: memeFacts(),
    outputMint: FIXTURE_MINTS.oldToken,
    output: trendingFacts(NOW),
  });
  assert.equal(fromNeither.feeSide, null);
  assert.equal(fromNeither.feeRaw, null);
  assert.match(fromNeither.feeRawUnknownBecause, /fee wallet takes/);
});

test("a stock decides the pair whatever pays for it", () => {
  const quotation = quote({ outputMint: FIXTURE_MINTS.stock, output: stockFacts() });
  assert.equal(quotation.flow, "XSTOCK");
  assert.equal(quotation.feeBps, FEE_POLICY_V2.XSTOCK.bps);
});

test("a launch preset is quoted from its own terms; an unknown and a closed one refuse apart", () => {
  const quotation = quoteLaunchFee("micro");
  const terms = presetTerms("micro");
  assert.equal(quotation.terms.curveFirstWindowStartBps, terms.curve.sniperFee.startBps);
  assert.equal(quotation.terms.graduationFeeBps, terms.graduation.feeBps);
  assert.equal(quotation.transaction, null);
  assert.equal(quotation.execution.open, false);

  assert.throws(
    () => quoteLaunchFee("nothing-of-that-name"),
    (error) => error.reasonCode === "LAUNCH_PRESET_UNKNOWN",
  );
  assert.throws(
    () => quoteLaunchFee("advanced"),
    (error) => error.reasonCode === "LAUNCH_PRESET_NOT_OPEN_TO_PEOPLE",
  );
});

/* ── the two reasons an action does not happen here ──────────────────────── */

const request = Object.freeze({
  network: MAINNET,
  mint: USDC_MAINNET,
  payTo: FIXTURE.payTo,
  amountBaseUnits: "100000",
  spender: FIXTURE.agent,
  agentBoundBaseUnits: "500000",
});

test("a sound mandate does not make an external request signable", () => {
  const decision = decideExternalExecution({
    read: smartAccountLimit({}, NOW),
    request,
    nowMs: NOW,
  });
  assert.equal(decision.state, "OWNER_SIGNATURE_REQUIRED");
  assert.equal(decision.mandateSound, true);
  assert.deepEqual([...decision.reasons], ["EXTERNAL_REQUEST_CARRIES_NO_OWNER_SIGNATURE"]);
  assert.equal(decision.programVerdict.authorization, "AGENT_ALONE");
});

test("a mandate with nothing left in it is reported as its own second reason", () => {
  /*
   * The case the task names. The signature requirement already settles the
   * answer, and the mandate verdict is still carried: an exhausted mandate is a
   * different defect, and a surface showing only the signature would hide it
   * until somebody opened the signature path onto an authority that was never
   * there.
   */
  const decision = decideExternalExecution({
    read: smartAccountLimit({ availableBaseUnits: "1" }, NOW),
    request,
    nowMs: NOW,
  });
  assert.equal(decision.state, "OWNER_SIGNATURE_REQUIRED");
  assert.equal(decision.mandateSound, false);
  assert.deepEqual(
    [...decision.reasons],
    ["EXTERNAL_REQUEST_CARRIES_NO_OWNER_SIGNATURE", "MANDATE_NOT_SOUND"],
  );
  assert.equal(decision.programVerdict.authorization, "HUMAN_SIGNATURE");
  assert.equal(decision.programVerdict.reasonCode, "MANDATE_AMOUNT_ABOVE_AVAILABLE");
});

test("an expired mandate and a program with no end date are each named, not collapsed", () => {
  const expired = decideExternalExecution({
    read: smartAccountLimit({ expiresAtMs: NOW - 1 }, NOW),
    request,
    nowMs: NOW,
  });
  assert.equal(expired.programVerdict.reasonCode, "MANDATE_EXPIRY_PASSED");

  const noExpiry = decideExternalExecution({
    read: {
      kind: "SQUADS_V4_SPENDING_LIMIT",
      state: "ACTIVE",
      account: "FtvsqSaokzzy76W9UQpX3uPX8rtz1mrqxhJ5NrpurtvX",
      network: request.network,
      mint: request.mint,
      spender: request.spender,
      destinations: [request.payTo],
      availableBaseUnits: "1000000",
    },
    request,
    nowMs: NOW,
  });
  assert.equal(noExpiry.programVerdict.reasonCode, "PROGRAM_HOLDS_NO_EXPIRY");
  assert.equal(noExpiry.state, "OWNER_SIGNATURE_REQUIRED");
});
