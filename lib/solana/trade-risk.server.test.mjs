/**
 * How a trade route builds the verdict: the terms of its own quote, the facts
 * this product holds itself, and the gateway's reading beside them. The
 * interesting case is the one production is in today — a gateway without the
 * token-facts route — where the whole must come back `INCOMPLETE` saying so.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { manualTradeBudget, rwaEligibilityOf, swapTradeRisk, swapTradeTerms, tradeRiskVerdict } from "./trade-risk.server.ts";

const OUTPUT = "So11111111111111111111111111111111111111112";
const INPUT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RETIRED = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
const NOW = new Date("2026-10-26T12:00:10.000Z");

const order = (over = {}) => ({
  provider: "jupiter",
  router: "metis-v1.6",
  mode: "manual",
  access: "production",
  tier: "pro",
  inputMint: INPUT,
  outputMint: OUTPUT,
  inAmountRaw: "10000000",
  outAmountRaw: "2000000000",
  minReceivedRaw: "1990000000",
  slippageBps: 50,
  route: [{ ammKey: "x", label: "Meteora DLMM", inputMint: INPUT, outputMint: OUTPUT, inAmountRaw: "10000000", outAmountRaw: "2000000000", basisPoints: 10_000 }],
  observedAt: "2026-10-26T12:00:05.000Z",
  reviewExpiresAt: "2026-10-26T12:00:40.000Z",
  source: { ref: "solana:mainnet:jupiter:/order", label: "Jupiter Swap API V2" },
  ...over,
});

test("the venue's own terms come out of the order, not out of its prose", () => {
  const terms = swapTradeTerms(order(), NOW);
  assert.equal(terms.slippage.kind, "BOUNDED");
  assert.equal(terms.slippage.statedBps, 50);
  /* 2 000 000 000 → 1 990 000 000 is 50 bps, worked out from the least the trade may receive. */
  assert.equal(terms.slippage.enforcedBps, 50);
  assert.equal(terms.quote.readAt, "2026-10-26T12:00:05.000Z");
  assert.equal(terms.quote.expiresAt, "2026-10-26T12:00:40.000Z");
  assert.equal(terms.venue.status, "LIVE");
  assert.equal(terms.path.hops.length, 1);
  assert.equal(terms.path.hops[0].venue, "Meteora DLMM");
  assert.equal(terms.slippage.source.ref, "solana:mainnet:jupiter:/order");

  /* A quote whose stated figure and whose own minimum disagree keeps both. */
  const wider = swapTradeTerms(order({ slippageBps: 10, minReceivedRaw: "1900000000" }), NOW);
  assert.equal(wider.slippage.statedBps, 10);
  assert.equal(wider.slippage.enforcedBps, 500);

  /* The keyless lane is named as the lane it is. */
  const keyless = swapTradeTerms(order({ access: "degraded", tier: "lite" }), NOW);
  assert.equal(keyless.venue.status, "RECOVERY");
  assert.match(keyless.venue.detail, /keyless lane/);
});

test("a deployment whose gateway has no token-facts route answers INCOMPLETE, and says that is why", async () => {
  const verdict = await swapTradeRisk({ order: order(), now: NOW, env: {}, fetchImpl: async () => assert.fail("asked a gateway it does not have") });
  assert.equal(verdict.verdict, "INCOMPLETE");
  assert.equal(verdict.trade.kind, "SWAP");
  assert.equal(verdict.trade.mint, OUTPUT);
  const mint = verdict.findings.find((found) => found.fact === "MINT_AND_PROGRAM");
  assert.match(mint.missing, /reads no market-data gateway/);
  /* The deal's own facts were still read. */
  assert.equal(verdict.findings.find((found) => found.fact === "SLIPPAGE").outcome, "ALLOWED");
  assert.equal(verdict.findings.find((found) => found.fact === "QUOTE_FRESHNESS").outcome, "ALLOWED");
  assert.equal(verdict.findings.find((found) => found.fact === "VENUE_STATUS").outcome, "ALLOWED");
  /* And by default a trade signed by hand is not under a rule's ceiling. */
  const budget = verdict.findings.find((found) => found.fact === "TRADE_BUDGET");
  assert.equal(budget.outcome, "ALLOWED");
  assert.match(budget.detail, /made by hand/);
});

test("a token the product no longer offers is refused whatever the chain says", async () => {
  const verdict = await tradeRiskVerdict({
    trade: { kind: "SWAP", network: "mainnet", mint: RETIRED },
    slippage: null,
    path: null,
    quote: null,
    venue: null,
    now: NOW,
    env: {},
  });
  assert.equal(verdict.verdict, "BLOCKED");
  const rwa = verdict.findings.find((found) => found.fact === "RWA_ELIGIBILITY");
  assert.equal(rwa.outcome, "BLOCKED");
  assert.match(rwa.detail, /no longer offers this token/);
});

test("the issuer registry is read as a fact with its version on it", () => {
  const withdrawn = rwaEligibilityOf(RETIRED, NOW);
  assert.equal(withdrawn.state, "NOT_OFFERED");
  assert.equal(withdrawn.source.ref, "ryntra.stocks.lifecycle-events");
  assert.match(withdrawn.source.label, /2026-/);

  const plain = rwaEligibilityOf(OUTPUT, NOW);
  assert.equal(plain.state, "NOT_A_REAL_WORLD_ASSET");
  assert.match(plain.detail, /no issuer event and no withdrawal/);

  const budget = manualTradeBudget(NOW);
  assert.equal(budget.state, "NOT_UNDER_A_LIMIT");
  assert.equal(budget.source.readAt, NOW.toISOString());
});

test("the gateway's facts, where it serves them, land in the verdict", async () => {
  const facts = {
    mint: OUTPUT,
    at: Date.parse("2026-10-26T12:00:00.000Z"),
    slot: 377_000_100,
    source: { id: "solana-chain", label: "Solana (chain, through an RPC)" },
    slots: { mint_account: 377_000_100, metadata: null, holders: 377_000_090, origin: 377_000_000, creator_holds: null },
    mint_account: {
      program: "spl-token",
      program_id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      decimals: 9,
      supply: "1000000000",
      mint_authority: null,
      freeze_authority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
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
      basis: "top_token_accounts",
      basis_why: null,
      holders: null,
      concentration: { over: "the twenty largest", complete: false, top1: "0.3", top5: "0.4", top10: "0.4", top20: "0.4" },
      concentration_plain_accounts: { over: "the plain accounts among the twenty largest", complete: false, top1: "0.03", top5: "0.06", top10: "0.06", top20: "0.06" },
      at_burn_address: { over: "the twenty largest", complete: false, share: "0" },
    },
    pools: [],
    origin: { first: null, exact: false, oldest: null, why: "the listing was not read to its end", creator: null, launchpad: null, created_by: null },
    creator_holds: null,
    after_launchpad: null,
    not_read: [{ fact: "origin", why: "the listing was not read to its end" }],
  };
  const fetchImpl = async () => new Response(JSON.stringify(facts), { status: 200, headers: { "content-type": "application/json" } });
  const verdict = await swapTradeRisk({ order: order(), now: NOW, env: { MD_GATEWAY_URL: "https://data.example.invalid" }, fetchImpl });
  /* The creator did not read, so the whole is INCOMPLETE — and the freeze
     authority it did read is still reported as the power it is. */
  assert.equal(verdict.verdict, "INCOMPLETE");
  assert.equal(verdict.findings.find((found) => found.fact === "FREEZE_AUTHORITY").outcome, "REVIEW_REQUIRED");
  assert.equal(verdict.findings.find((found) => found.fact === "HOLDER_CONCENTRATION").outcome, "ALLOWED");
  const creator = verdict.findings.find((found) => found.fact === "CREATOR_BEHAVIOUR");
  assert.equal(creator.outcome, "INCOMPLETE");
  assert.match(creator.missing, /not read to its end/);
});
