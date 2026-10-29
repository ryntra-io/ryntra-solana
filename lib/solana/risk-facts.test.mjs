/**
 * The reader of the gateway's token facts. Every path that does not end in a
 * parsed answer must end in `NOT_READ` with a reason a Review can show — and
 * none of them may end in a fact that was never read.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readRiskGatewayEnv, readTokenRiskFacts, RISK_FACTS_PATH, TokenRiskFactsSchema } from "./risk-facts.ts";

const MINT = "So11111111111111111111111111111111111111112";
const GATEWAY = "https://data.example.invalid";
const ENV = { MD_GATEWAY_URL: GATEWAY };
const NOW = () => new Date("2026-10-26T12:00:00.000Z");

const answer = () => ({
  mint: MINT,
  at: Date.parse("2026-10-26T11:59:58.000Z"),
  slot: 377_000_100,
  source: { id: "solana-chain", label: "Solana (chain, through an RPC)" },
  note: { en: "Facts read from the chain.", uk: "Факти, прочитані з ланцюга." },
  slots: { mint_account: 377_000_100, metadata: 377_000_100, holders: 377_000_090, origin: 377_000_000, creator_holds: null },
  mint_account: {
    program: "spl-token-2022",
    program_id: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    decimals: 9,
    supply: "1000000000",
    mint_authority: null,
    freeze_authority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
    transfer_fee: {
      older: { fee_bps: 0, maximum: "0", maximum_why: null, epoch: 700 },
      newer: { fee_bps: 150, maximum: null, maximum_why: "the cap is larger than JSON carries exactly", epoch: 820 },
      in_force: { fee_bps: 150, maximum: null, maximum_why: "the cap is larger than JSON carries exactly", epoch: 820 },
      in_force_why: null,
      fee_authority: null,
      withdraw_authority: null,
    },
    permanent_delegate: null,
    new_accounts_frozen: false,
    transfer_hook: null,
    pausable: null,
    non_transferable: false,
    close_authority: null,
    ui_multiplier: null,
    extensions: ["transferFeeConfig"],
  },
  metadata: { name: "Example", symbol: "EX", update_authority: null },
  holders: {
    slot: 377_000_090,
    basis: "top_token_accounts",
    basis_why: "the exact read was not asked for",
    holders: null,
    accounts: null,
    top: [],
    concentration: { over: "the twenty largest accounts", complete: false, top1: "0.2", top5: "0.4", top10: "0.5", top20: "0.55" },
    concentration_plain_accounts: { over: "the plain accounts among the twenty largest", complete: false, top1: "0.08", top5: "0.15", top10: "0.15", top20: "0.15" },
    at_burn_address: { over: "the twenty largest accounts", complete: false, share: "0" },
  },
  pools: [{ pool: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", kind: "pool", program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", program_name: "Meteora DLMM", slot: 377_000_099, lp: { kind: "positions", why: "liquidity in bins" } }],
  origin: {
    read_from: { address: "11111111111111111111111111111112", kind: "metadata_account", why: "written when the token is created" },
    read_slot: 377_000_000,
    metadata: { name: "Example", symbol: "EX", uri: "https://example.invalid/x.json" },
    update_authority: { address: null, mutable: false, mutable_why: null },
    first: { signature: "a".repeat(64), slot: 376_000_000, at: 1_761_000_000 },
    exact: true,
    oldest: null,
    signatures_seen: 12,
    why: null,
    creator: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", basis: "the fee payer of the token's first transaction" },
    launchpad: null,
    created_by: null,
    programs: [],
  },
  creator_holds: null,
  after_launchpad: null,
  not_read: [{ fact: "creator_holds", why: "the RPC refused getTokenAccountsByOwner with 429" }],
});

const serves = (status, body) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
};

test("the gateway's address comes from the environment, and nothing else does", () => {
  assert.deepEqual(readRiskGatewayEnv(ENV), { baseUrl: GATEWAY });
  assert.equal(readRiskGatewayEnv({}), null);
  assert.equal(readRiskGatewayEnv({ MD_GATEWAY_URL: "   " }), null);
  assert.equal(readRiskGatewayEnv({ MD_GATEWAY_URL: "ftp://data.example.invalid" }), null);
  assert.deepEqual(readRiskGatewayEnv({ MD_GATEWAY_URL: `${GATEWAY}///` }), { baseUrl: GATEWAY });
});

test("an answer in the shape this product reads becomes facts, extra fields and all", async () => {
  const { fetchImpl, calls } = serves(200, answer());
  const reading = await readTokenRiskFacts({ mint: MINT, env: ENV, fetchImpl, now: NOW });
  assert.equal(reading.state, "READ");
  assert.equal(calls[0], `${GATEWAY}${RISK_FACTS_PATH}?mint=${MINT}`);
  assert.equal(reading.facts.mint_account.freeze_authority, "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG");
  assert.equal(reading.facts.mint_account.transfer_fee.in_force.fee_bps, 150);
  assert.equal(reading.facts.holders.concentration_plain_accounts.top1, "0.08");
  /* A family the gateway itself could not read stays unread here. */
  assert.equal(reading.facts.creator_holds, null);
  assert.deepEqual(reading.facts.not_read, [{ fact: "creator_holds", why: "the RPC refused getTokenAccountsByOwner with 429" }]);
  assert.doesNotThrow(() => TokenRiskFactsSchema.parse(reading.facts));
});

test("without a gateway in the environment nothing is read, and the reason says which", async () => {
  const reading = await readTokenRiskFacts({ mint: MINT, env: {}, fetchImpl: async () => assert.fail("asked a gateway it does not have"), now: NOW });
  assert.equal(reading.state, "NOT_READ");
  assert.match(reading.why, /reads no market-data gateway/);
  assert.equal(reading.readAt, "2026-10-26T12:00:00.000Z");
});

test("a gateway whose image predates the route says so, not that the token has no facts", async () => {
  const { fetchImpl } = serves(404, { error: "not_found", message: "the gateway reads no chain for token facts: no RPC is named" });
  const reading = await readTokenRiskFacts({ mint: MINT, env: ENV, fetchImpl, now: NOW });
  assert.equal(reading.state, "NOT_READ");
  assert.match(reading.why, /serves no token facts at this address yet/);
});

test("a gateway's own refusal is passed on in its own words", async () => {
  for (const [status, error, message] of [
    [429, "rate", "too many tokens from one address; slow down"],
    [503, "budget", "the day's chain calls for token facts are spent; the facts are not guessed"],
    [503, "slow", "the chain did not answer in time"],
    [404, "not_read", "7Xyz is not a mint account of either token program"],
  ]) {
    const { fetchImpl } = serves(status, { error, message });
    const reading = await readTokenRiskFacts({ mint: MINT, env: ENV, fetchImpl, now: NOW });
    assert.equal(reading.state, "NOT_READ");
    assert.match(reading.why, new RegExp(error));
    assert.ok(reading.why.includes(message), reading.why);
  }
});

test("a gateway that does not answer, or answers something else, reads as nothing", async () => {
  const timedOut = await readTokenRiskFacts({
    mint: MINT,
    env: ENV,
    now: NOW,
    fetchImpl: async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.equal(timedOut.state, "NOT_READ");
  assert.match(timedOut.why, /did not answer in time/);

  const unreachable = await readTokenRiskFacts({ mint: MINT, env: ENV, now: NOW, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(unreachable.state, "NOT_READ");
  assert.match(unreachable.why, /could not be reached/);

  const surprising = serves(200, { mint: MINT, at: "a while ago" });
  const unparsed = await readTokenRiskFacts({ mint: MINT, env: ENV, fetchImpl: surprising.fetchImpl, now: NOW });
  assert.equal(unparsed.state, "NOT_READ");
  assert.match(unparsed.why, /did not match the shape this product reads/);

  /* A body that parses but is about another token is not this token's facts. */
  const elsewhere = serves(200, { ...answer(), mint: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
  const other = await readTokenRiskFacts({ mint: MINT, env: ENV, fetchImpl: elsewhere.fetchImpl, now: NOW });
  assert.equal(other.state, "NOT_READ");
  assert.match(other.why, /about a different mint/);
});

test("no reason a person reads carries the address this deployment reads through", async () => {
  const { fetchImpl } = serves(500, { error: "oops", message: "broken" });
  const refused = await readTokenRiskFacts({ mint: MINT, env: ENV, fetchImpl, now: NOW });
  const unreachable = await readTokenRiskFacts({ mint: MINT, env: ENV, now: NOW, fetchImpl: async () => { throw new Error(`connect ECONNREFUSED ${GATEWAY}`); } });
  for (const reading of [refused, unreachable]) {
    assert.equal(reading.state, "NOT_READ");
    assert.ok(!reading.why.includes("data.example.invalid"), reading.why);
  }
});
