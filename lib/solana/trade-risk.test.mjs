/**
 * The trade risk verdict, one test per state and one per way a fact can fail
 * to arrive. Three things this file is really about:
 *
 * - the four words and nothing else, with `NO_KNOWN_BLOCKER` reachable only
 *   when all thirteen facts were read and none of them bites;
 * - silence is never a pass: a gateway that says nothing, a family the chain
 *   would not serve, a quote with no time — each ends `INCOMPLETE` with the
 *   missing thing named;
 * - no verdict this engine can produce contains the word "safe", in either
 *   language, anywhere.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { POLICY_OUTCOMES, POLICY_VERDICTS } from "./contracts.ts";
import { SOLANA_NETWORKS } from "./rpc.ts";
import {
  evaluateTradeRisk,
  TRADE_RISK_FACTS,
  TRADE_RISK_LIMITS,
  TRADE_RISK_NETWORKS,
  TRADE_RISK_OUTCOMES,
  TRADE_RISK_VERDICTS,
  TradeRiskVerdictSchema,
} from "./trade-risk.ts";

const MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const AUTHORITY = "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG";
const CREATOR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
const AMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

const NOW = new Date("2026-10-26T12:00:10.000Z");
const CHAIN_AT = Date.parse("2026-10-26T12:00:00.000Z");

const SOURCE = { ref: "jupiter:order", label: "Jupiter Swap API V2", readAt: "2026-10-26T12:00:05.000Z", slot: null };

const concentration = (top1, top5, complete = false) => ({
  over: "the twenty largest accounts whose owner was read",
  complete,
  top1: String(top1),
  top5: String(top5),
  top10: String(top5),
  top20: String(top5),
});

/** A token that reads cleanly: fixed supply, nobody can freeze, spread holders, a real pool. */
function chainFacts() {
  return {
    mint: MINT,
    at: CHAIN_AT,
    slot: 377_000_100,
    source: { id: "solana-chain", label: "Solana (chain, through an RPC)" },
    slots: { mint_account: 377_000_100, metadata: 377_000_100, holders: 377_000_090, origin: 377_000_000, creator_holds: 377_000_095 },
    mint_account: {
      program: "spl-token",
      program_id: SPL_TOKEN,
      decimals: 6,
      supply: "1000000000000",
      mint_authority: null,
      freeze_authority: null,
      transfer_fee: null,
      permanent_delegate: null,
      new_accounts_frozen: null,
      transfer_hook: null,
      pausable: null,
      non_transferable: false,
      close_authority: null,
      extensions: [],
    },
    holders: {
      slot: 377_000_090,
      basis: "all_token_accounts",
      basis_why: null,
      holders: 14_320,
      concentration: concentration(0.11, 0.3, true),
      concentration_plain_accounts: concentration(0.04, 0.09),
      at_burn_address: { over: "the twenty largest accounts", complete: false, share: "0" },
    },
    pools: [{ pool: POOL, kind: "pool", program: AMM, program_name: "Meteora DLMM", slot: 377_000_099 }],
    origin: {
      first: { signature: "3".repeat(64), slot: 377_000_000, at: 1_761_000_000 },
      exact: true,
      oldest: null,
      why: null,
      creator: { address: CREATOR, basis: "the fee payer of the token's first transaction" },
      launchpad: null,
      created_by: { program: AMM, name: null },
    },
    creator_holds: { amount: "10000000000", share: "0.01", basis: "every token account of this mint owned by the creator", slot: 377_000_095 },
    after_launchpad: null,
    not_read: [],
  };
}

const read = (facts) => ({ state: "READ", mint: MINT, facts, readAt: "2026-10-26T12:00:00.000Z" });

function evidence(over = {}) {
  return {
    trade: { kind: "SWAP", network: "mainnet", mint: MINT },
    chain: read(chainFacts()),
    assetReview: null,
    slippage: {
      kind: "BOUNDED",
      statedBps: 50,
      enforcedBps: 50,
      basis: "The quote is 2000000 raw units and the least this trade may receive is 1990000.",
      source: SOURCE,
    },
    path: { hops: [{ label: "1000000 → 1990000", venue: "Meteora DLMM" }], source: SOURCE },
    quote: { readAt: "2026-10-26T12:00:05.000Z", expiresAt: "2026-10-26T12:00:40.000Z", source: SOURCE },
    venue: { id: "jupiter", label: "Jupiter metis-v1.6", status: "LIVE", detail: "Priced on its keyed lane (pro).", source: SOURCE },
    budget: { state: "NOT_UNDER_A_LIMIT", detail: "This trade is made by hand, not under a saved rule.", source: SOURCE },
    rwa: { state: "NOT_A_REAL_WORLD_ASSET", detail: "No issuer's own window governs this trade.", source: SOURCE },
    ...over,
  };
}

const judge = (over = {}) => evaluateTradeRisk({ evidence: evidence(over), now: NOW });
const factOf = (verdict, name) => verdict.findings.find((found) => found.fact === name);

/** Every string in a verdict, however deep. */
function strings(value, carried = []) {
  if (typeof value === "string") carried.push(value);
  else if (Array.isArray(value)) for (const row of value) strings(row, carried);
  else if (value && typeof value === "object") for (const row of Object.values(value)) strings(row, carried);
  return carried;
}

test("a reading with nothing against it is NO_KNOWN_BLOCKER, never anything stronger", () => {
  const verdict = judge();
  assert.equal(verdict.verdict, "NO_KNOWN_BLOCKER");
  assert.deepEqual(
    verdict.findings.map((found) => found.fact),
    [...TRADE_RISK_FACTS],
  );
  assert.equal(verdict.findings.length, 13);
  for (const found of verdict.findings) {
    assert.equal(found.outcome, "ALLOWED", `${found.fact}: ${found.detail}`);
    assert.notEqual(found.source, null, `${found.fact} states no source`);
    assert.equal(found.missing, null);
  }
  /* The verdict parses as its own published shape, thresholds and all. */
  assert.doesNotThrow(() => TradeRiskVerdictSchema.parse(verdict));
  assert.equal(verdict.limits.slippageBlockBps, TRADE_RISK_LIMITS.slippageBlockBps);
});

test("every fact names its source and the time it was read", () => {
  const verdict = judge();
  const chain = factOf(verdict, "MINT_AUTHORITY");
  assert.equal(chain.source.ref, "solana-chain");
  assert.equal(chain.source.readAt, new Date(CHAIN_AT).toISOString());
  /* The chain's own clock travels beside our own: a slot, per family. */
  assert.equal(chain.source.slot, 377_000_100);
  assert.equal(factOf(verdict, "HOLDER_CONCENTRATION").source.slot, 377_000_090);
  assert.equal(factOf(verdict, "CREATOR_BEHAVIOUR").source.slot, 377_000_095);
  for (const found of verdict.findings) {
    if (found.source) assert.ok(!Number.isNaN(Date.parse(found.source.readAt)), `${found.fact} has no readable time`);
  }
});

test("a power someone still holds asks for a person: REVIEW_REQUIRED", () => {
  const facts = chainFacts();
  facts.mint_account.mint_authority = AUTHORITY;
  const verdict = judge({ chain: read(facts) });
  assert.equal(verdict.verdict, "REVIEW_REQUIRED");
  const found = factOf(verdict, "MINT_AUTHORITY");
  assert.equal(found.outcome, "REVIEW_REQUIRED");
  assert.match(found.detail, /may still mint more/);
  assert.match(found.detail, new RegExp(AUTHORITY));
  /* Nothing else moved. */
  assert.equal(verdict.findings.filter((row) => row.outcome !== "ALLOWED").length, 1);
});

test("a token whose transfers are paused is BLOCKED", () => {
  const facts = chainFacts();
  facts.mint_account.program = "spl-token-2022";
  facts.mint_account.program_id = TOKEN_2022;
  facts.mint_account.extensions = ["pausableConfig"];
  facts.mint_account.pausable = { paused: true, authority: AUTHORITY };
  const verdict = judge({ chain: read(facts) });
  assert.equal(verdict.verdict, "BLOCKED");
  const found = factOf(verdict, "TOKEN_RESTRICTIONS");
  assert.equal(found.outcome, "BLOCKED");
  assert.match(found.detail, /paused right now/);
});

test("a token that can freeze a holder's account is REVIEW_REQUIRED; one whose accounts start frozen is BLOCKED", () => {
  const withAuthority = chainFacts();
  withAuthority.mint_account.freeze_authority = AUTHORITY;
  const asked = judge({ chain: read(withAuthority) });
  assert.equal(asked.verdict, "REVIEW_REQUIRED");
  const power = factOf(asked, "FREEZE_AUTHORITY");
  assert.equal(power.outcome, "REVIEW_REQUIRED");
  assert.match(power.detail, /can freeze any holder's account/);
  assert.match(power.detail, /cannot sell/);

  /* A frozen-by-default mint is not a power someone holds — it is a transfer
     that will not happen, so it refuses rather than asking. */
  const frozen = chainFacts();
  frozen.mint_account.program = "spl-token-2022";
  frozen.mint_account.program_id = TOKEN_2022;
  frozen.mint_account.extensions = ["defaultAccountState"];
  frozen.mint_account.freeze_authority = AUTHORITY;
  frozen.mint_account.new_accounts_frozen = true;
  const refused = judge({ chain: read(frozen) });
  assert.equal(refused.verdict, "BLOCKED");
  const stopped = factOf(refused, "FREEZE_AUTHORITY");
  assert.equal(stopped.outcome, "BLOCKED");
  assert.match(stopped.detail, /start frozen/);
  assert.match(stopped.detail, /cannot move them/);
});

test("the gateway's silence is INCOMPLETE with the reason, and never NO_KNOWN_BLOCKER", () => {
  const why = "This deployment reads no market-data gateway, so the token's chain facts were not read at all.";
  const verdict = judge({ chain: { state: "NOT_READ", mint: MINT, why, readAt: "2026-10-26T12:00:00.000Z" } });
  assert.equal(verdict.verdict, "INCOMPLETE");
  const fromChain = ["MINT_AND_PROGRAM", "TOKEN_EXTENSIONS", "MINT_AUTHORITY", "FREEZE_AUTHORITY", "TOKEN_RESTRICTIONS", "HOLDER_CONCENTRATION", "CREATOR_BEHAVIOUR"];
  for (const name of fromChain) {
    const found = factOf(verdict, name);
    assert.equal(found.outcome, "INCOMPLETE", name);
    /* The missing thing is named, and the gateway's own reason travels with it. */
    assert.ok(found.missing.includes(why), `${name} does not say why`);
    assert.equal(found.source, null, `${name} names a source it did not have`);
  }
  /* What the venue itself knew is still read: silence about the token is not silence about the deal. */
  for (const name of ["SLIPPAGE", "LIQUIDITY_PATH", "QUOTE_FRESHNESS", "VENUE_STATUS", "RWA_ELIGIBILITY", "TRADE_BUDGET"]) {
    assert.equal(factOf(verdict, name).outcome, "ALLOWED", name);
  }
});

test("facts the chain served in part are INCOMPLETE only where they are missing", () => {
  const facts = chainFacts();
  facts.holders = null;
  facts.creator_holds = null;
  facts.slots.holders = null;
  facts.not_read = [
    { fact: "holders", why: "the RPC refused getTokenLargestAccounts with 429" },
    { fact: "creator_holds", why: "one of the creator's accounts came back without a balance we can read" },
  ];
  const verdict = judge({ chain: read(facts) });
  assert.equal(verdict.verdict, "INCOMPLETE");
  const holders = factOf(verdict, "HOLDER_CONCENTRATION");
  assert.equal(holders.outcome, "INCOMPLETE");
  assert.match(holders.missing, /429/);
  const creator = factOf(verdict, "CREATOR_BEHAVIOUR");
  assert.equal(creator.outcome, "INCOMPLETE");
  assert.match(creator.missing, /without a balance/);
  assert.match(creator.missing, new RegExp(CREATOR));
  /* The mint's own facts came through and are still read as facts. */
  assert.equal(factOf(verdict, "MINT_AUTHORITY").outcome, "ALLOWED");
  assert.equal(factOf(verdict, "FREEZE_AUTHORITY").outcome, "ALLOWED");
  assert.equal(verdict.findings.filter((row) => row.outcome === "INCOMPLETE").length, 2);
});

test("supply in few hands asks for a person, and says which threshold it passed", () => {
  const facts = chainFacts();
  facts.holders.concentration_plain_accounts = concentration(0.42, 0.61);
  const verdict = judge({ chain: read(facts) });
  assert.equal(verdict.verdict, "REVIEW_REQUIRED");
  const found = factOf(verdict, "HOLDER_CONCENTRATION");
  assert.equal(found.outcome, "REVIEW_REQUIRED");
  assert.match(found.detail, /42%/);
  assert.match(found.detail, /20%/);
  assert.match(found.detail, /move the price on its own/);
  /* The set is not every account, so the share is stated as a floor. */
  assert.match(found.detail, /a floor rather than the whole truth/);

  /* Five accounts holding it between them is the same fact, spread. */
  const spread = chainFacts();
  spread.holders.concentration_plain_accounts = concentration(0.12, 0.72);
  const second = judge({ chain: read(spread) });
  assert.equal(factOf(second, "HOLDER_CONCENTRATION").outcome, "REVIEW_REQUIRED");
  assert.match(factOf(second, "HOLDER_CONCENTRATION").detail, /five largest plain accounts/);
});

test("a creator still holding what they created asks for a person", () => {
  const facts = chainFacts();
  facts.creator_holds.share = "0.34";
  facts.origin.launchpad = { program: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", name: "pump.fun" };
  const verdict = judge({ chain: read(facts) });
  const found = factOf(verdict, "CREATOR_BEHAVIOUR");
  assert.equal(found.outcome, "REVIEW_REQUIRED");
  assert.match(found.detail, /34%/);
  assert.match(found.detail, /pump\.fun/);
});

test("a quote past its window is BLOCKED; one merely old asks for a person", () => {
  const expired = judge({
    quote: { readAt: "2026-10-26T11:58:00.000Z", expiresAt: "2026-10-26T11:59:00.000Z", source: SOURCE },
  });
  assert.equal(expired.verdict, "BLOCKED");
  const closed = factOf(expired, "QUOTE_FRESHNESS");
  assert.equal(closed.outcome, "BLOCKED");
  assert.match(closed.detail, /window closed/);
  assert.match(closed.detail, /Ask for a fresh quote/);

  const old = judge({ quote: { readAt: "2026-10-26T11:59:00.000Z", expiresAt: null, source: SOURCE } });
  assert.equal(old.verdict, "REVIEW_REQUIRED");
  const aged = factOf(old, "QUOTE_FRESHNESS");
  assert.equal(aged.outcome, "REVIEW_REQUIRED");
  assert.match(aged.detail, /70s ago/);
  assert.match(aged.detail, /states no expiry of its own/);
});

test("chain facts older than their window stop being facts to decide on", () => {
  const facts = chainFacts();
  facts.at = Date.parse("2026-10-26T11:40:00.000Z");
  const verdict = judge({ chain: read(facts) });
  assert.equal(verdict.verdict, "INCOMPLETE");
  const found = factOf(verdict, "MINT_AUTHORITY");
  assert.equal(found.outcome, "INCOMPLETE");
  assert.match(found.missing, /past the 600s/);
  /* What did not come from the chain is untouched by the chain's age. */
  assert.equal(factOf(verdict, "VENUE_STATUS").outcome, "ALLOWED");
});

test("the slippage the chain enforces governs, not the figure the venue labels", () => {
  const wide = judge({ slippage: { kind: "BOUNDED", statedBps: 100, enforcedBps: 2_400, basis: "b.", source: SOURCE } });
  assert.equal(wide.verdict, "BLOCKED");
  assert.match(factOf(wide, "SLIPPAGE").detail, /stops being a price/);

  const disagreeing = judge({ slippage: { kind: "BOUNDED", statedBps: 50, enforcedBps: 140, basis: "b.", source: SOURCE } });
  assert.equal(factOf(disagreeing, "SLIPPAGE").outcome, "REVIEW_REQUIRED");
  assert.match(factOf(disagreeing, "SLIPPAGE").detail, /wider of the two/);

  const unknown = judge({ slippage: { kind: "BOUNDED", statedBps: 50, enforcedBps: null, basis: "b.", source: SOURCE } });
  assert.equal(unknown.verdict, "INCOMPLETE");
  assert.equal(factOf(unknown, "SLIPPAGE").missing, "the least this trade may receive");

  /* An order that fills at its own price has no slippage to bound, and says so. */
  const limit = judge({
    trade: { kind: "SPOT_LIMIT", network: "mainnet", mint: MINT },
    slippage: { kind: "PRICE_IS_THE_LIMIT", basis: "A limit order fills at 1.25 USDC or not at all.", source: SOURCE },
  });
  assert.equal(limit.verdict, "NO_KNOWN_BLOCKER");
  assert.equal(limit.trade.kind, "SPOT_LIMIT");
  assert.match(factOf(limit, "SLIPPAGE").detail, /fills at its own price/);
});

test("a venue that is not live is read as what it is", () => {
  const paper = judge({ venue: { ...evidence().venue, status: "PAPER" } });
  assert.equal(factOf(paper, "VENUE_STATUS").outcome, "REVIEW_REQUIRED");
  assert.match(factOf(paper, "VENUE_STATUS").detail, /nothing here settles on the network/);

  const off = judge({ venue: { ...evidence().venue, status: "UNAVAILABLE" } });
  assert.equal(off.verdict, "BLOCKED");

  const unknown = judge({ venue: { ...evidence().venue, status: "UNKNOWN" } });
  assert.equal(unknown.verdict, "INCOMPLETE");
  assert.equal(factOf(unknown, "VENUE_STATUS").source, null);
});

test("what the trade may spend, and what an issuer allows, are facts like any other", () => {
  const over = judge({ budget: { state: "EXCEEDED", detail: "$40 of the month's $200 is left and this purchase is $60.", source: SOURCE } });
  assert.equal(over.verdict, "BLOCKED");
  assert.equal(factOf(over, "TRADE_BUDGET").outcome, "BLOCKED");

  const unknownSpend = judge({ budget: { state: "SPEND_UNKNOWN", detail: "Two purchases of this month have no settled outcome yet.", source: SOURCE } });
  assert.equal(unknownSpend.verdict, "INCOMPLETE");

  const withdrawn = judge({ rwa: { state: "NOT_OFFERED", detail: "Ryntra no longer offers this token on either side.", source: SOURCE } });
  assert.equal(withdrawn.verdict, "BLOCKED");
  assert.equal(factOf(withdrawn, "RWA_ELIGIBILITY").outcome, "BLOCKED");

  const noBudget = judge({ budget: null, rwa: null });
  assert.equal(noBudget.verdict, "INCOMPLETE");
  assert.equal(factOf(noBudget, "TRADE_BUDGET").missing, "What this trade is allowed to spend was not read.");
});

test("a refusal outranks missing evidence, which outranks a look", () => {
  /* A closed quote on a reading where the token's facts never arrived: the
     refusal is the verdict, because what is forbidden stays forbidden. */
  const both = judge({
    chain: { state: "NOT_READ", mint: MINT, why: "The market-data gateway did not answer in time.", readAt: "2026-10-26T12:00:00.000Z" },
    quote: { readAt: "2026-10-26T11:58:00.000Z", expiresAt: "2026-10-26T11:59:00.000Z", source: SOURCE },
  });
  assert.equal(both.verdict, "BLOCKED");

  /* Missing evidence over a look: a token asking for a person whose holders
     did not read is INCOMPLETE, not REVIEW_REQUIRED. */
  const facts = chainFacts();
  facts.mint_account.mint_authority = AUTHORITY;
  facts.holders = null;
  facts.not_read = [{ fact: "holders", why: "the read was cut by its byte cap" }];
  const partial = judge({ chain: read(facts) });
  assert.equal(partial.verdict, "INCOMPLETE");
  assert.equal(factOf(partial, "MINT_AUTHORITY").outcome, "REVIEW_REQUIRED");
});

test("the review over the mint is folded in where it is harder than the chain", () => {
  const review = {
    schema: "ryntra.solana.policy-verdict",
    schemaVersion: "0.1.0",
    verdict: "BLOCKED",
    findings: [
      { rule: "NETWORK_ALLOWED", outcome: "ALLOWED", detail: "Network mainnet is allowed by the policy." },
      {
        rule: "PERMANENT_DELEGATE_ACCEPTED",
        outcome: "BLOCKED",
        detail: "The mint carries a permanent delegate and the policy does not accept that power.",
      },
      { rule: "EXTENSIONS_UNDERSTOOD", outcome: "INCOMPLETE", detail: "The mint carries extensions this version has no semantics for (metadataPointer)." },
    ],
    evaluatedAt: "2026-10-26T12:00:08.000Z",
  };
  const verdict = judge({ assetReview: review });
  assert.equal(verdict.verdict, "BLOCKED");
  const restrictions = factOf(verdict, "TOKEN_RESTRICTIONS");
  assert.equal(restrictions.outcome, "BLOCKED");
  assert.equal(restrictions.source.ref, "ryntra.solana.policy-verdict");
  assert.match(restrictions.detail, /permanent delegate/);
  const extensions = factOf(verdict, "TOKEN_EXTENSIONS");
  assert.equal(extensions.outcome, "INCOMPLETE");
  assert.match(extensions.missing, /no semantics for/);

  /* A review with nothing against the token changes none of the facts. */
  const clean = judge({
    assetReview: { ...review, verdict: "NO_KNOWN_BLOCKER", findings: [review.findings[0]] },
  });
  assert.equal(clean.verdict, "NO_KNOWN_BLOCKER");
  assert.equal(factOf(clean, "TOKEN_RESTRICTIONS").source.ref, "solana-chain");
});

test("an account that is not a mint is not a token with no powers", () => {
  const facts = chainFacts();
  facts.mint_account = null;
  facts.slots.mint_account = null;
  const verdict = judge({ chain: read(facts) });
  assert.equal(verdict.verdict, "INCOMPLETE");
  for (const name of ["MINT_AND_PROGRAM", "TOKEN_EXTENSIONS", "MINT_AUTHORITY", "FREEZE_AUTHORITY", "TOKEN_RESTRICTIONS"]) {
    assert.equal(factOf(verdict, name).outcome, "INCOMPLETE", name);
  }
});

test("no verdict this engine produces says «safe», in any language", () => {
  const forbidden = [/\bsafe\b/i, /\bsafety\b/i, /безпечн/i, /безопасн/i, /\bscam\b/i, /\bgood to go\b/i];
  const verdicts = [
    judge(),
    judge({ chain: { state: "NOT_READ", mint: MINT, why: "The market-data gateway did not answer in time.", readAt: "2026-10-26T12:00:00.000Z" } }),
    judge({ budget: { state: "EXCEEDED", detail: "The month's ceiling is spent.", source: SOURCE } }),
    judge({ venue: { ...evidence().venue, status: "PAPER" } }),
  ];
  const facts = chainFacts();
  facts.mint_account.freeze_authority = AUTHORITY;
  facts.mint_account.mint_authority = AUTHORITY;
  facts.holders.concentration_plain_accounts = concentration(0.51, 0.8);
  verdicts.push(judge({ chain: read(facts) }));

  for (const verdict of verdicts) {
    for (const text of strings(verdict)) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(text), `a verdict said "${text}" (${pattern})`);
      }
    }
  }
  /* And the vocabulary itself has no such word to reach for. */
  assert.deepEqual([...TRADE_RISK_VERDICTS], ["NO_KNOWN_BLOCKER", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]);
  for (const word of TRADE_RISK_VERDICTS) assert.ok(!/safe/i.test(word));
});

test("every state is reachable, and only the four are", () => {
  const reached = new Set([
    judge().verdict,
    judge({ chain: { state: "NOT_READ", mint: MINT, why: "no gateway", readAt: "2026-10-26T12:00:00.000Z" } }).verdict,
    judge({ venue: { ...evidence().venue, status: "PAPER" } }).verdict,
    judge({ budget: { state: "EXCEEDED", detail: "spent.", source: SOURCE } }).verdict,
  ]);
  assert.deepEqual([...reached].sort(), ["BLOCKED", "INCOMPLETE", "NO_KNOWN_BLOCKER", "REVIEW_REQUIRED"]);
  for (const state of reached) assert.ok(TRADE_RISK_VERDICTS.includes(state));
});

test("the four words, the outcomes and the networks are the ones the evidence layer already uses", () => {
  /* The engine writes these lists out instead of importing them, so that the
     published contract does not pull an RPC client into a browser. This is
     what keeps the two copies the same list. */
  assert.deepEqual([...TRADE_RISK_VERDICTS], [...POLICY_VERDICTS]);
  assert.deepEqual([...TRADE_RISK_OUTCOMES], [...POLICY_OUTCOMES]);
  assert.deepEqual([...TRADE_RISK_NETWORKS], [...SOLANA_NETWORKS]);
});
