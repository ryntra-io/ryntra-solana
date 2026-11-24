// «Повторюй за гаманцем»: her agent repeats a wallet's buys and sales on a
// share of her own budget — paper first; the leader's exit never becomes the copy's entry; the copy's price stays near
// the leader's; the month's fees said before she starts; the copied wallets' reads under a day's ceiling of credits;
// money behind a closed switch and a signer rule that is its own task.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { COPY_BOUNDS, COPY_NETWORK_SOL, COPY_SHARES, COPY_SIGNER_READY, COPY_START_READY, copyBudgetIssue, copyBudgetOf, copyMonthFees, copyMoneyOpen, copyTermsOf, leaderLeft, leaderPriceSol, pastBound, termDayOf } from "./copy-agent.ts";
import { changePaper, fillCopy, PAPER_LATE_S, paperSummary, readPaper, startAgentCopy, startCopy } from "./paper.ts";
import { COPY_CALL_CREDITS, COPY_READ_WORST, runWalletWatchPass } from "./run.ts";
import { WRAPPED_SOL } from "./trades.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const LEADER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OWNER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MEME = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const OTHER = "Dp3JBaPCdx3N7Xx9gsQVcE9WDAmCEQ5HyfTdrDoXpump";
const S0 = Date.parse("2026-11-21T10:00:00Z") / 1000;
const SOL_USD = 200;
const iso = (s) => new Date(s * 1000).toISOString();

let slot = 1_000;
/** A leader's trade against SOL: whole tokens (6 decimals), SOL paid or got, seconds from S0. */
const trade = (side, tokens, sol, at, mint = MEME) => ({
  signature: `${side}${at}${mint.slice(0, 4)}`.padEnd(88, "x"),
  slot: (slot += 3),
  at: S0 + at,
  side,
  mint,
  tokensRaw: String(Math.round(tokens * 1e6)),
  decimals: 6,
  quote: "SOL",
  quoteAmount: sol,
  paidBy: null,
});
/** A coin priced in dollars so that a SOL buys `perSol` tokens — 1e6 tokens a SOL is $0.0002 at SOL's $200. */
const facts = (entries) => new Map(entries.map(([mint, priceUsd, liquidityUsd = 400_000]) => [mint, { priceUsd, liquidityUsd, symbol: "M" }]));
const AT_LEADER = 0.0002;

/** Her agent's copy: 1 SOL a day, a trade a quarter of it, a week, the bound 5 %. */
const agentCopy = (overrides = {}) => {
  const terms = copyTermsOf({ perDaySol: 1, sharePct: 25, days: 7, ...overrides }, iso(S0));
  return startAgentCopy([], LEADER, { terms, slippagePct: overrides.slippagePct ?? 5, name: null }, iso(S0))[0];
};

/* ---------------------------------------------------------------- terms */

test("her budget is hers: any day's sum, a trade its share, the mandate's technical bounds only", () => {
  assert.deepEqual([...COPY_SHARES], [10, 25, 50, 100]);
  const big = copyBudgetOf({ perDaySol: 250, sharePct: 25, days: 30 });
  assert.equal(big.perDay, 250_000_000_000n, "no ceiling of Ryntra's on the day");
  assert.equal(big.perTrade, 62_500_000_000n, "a trade is a quarter of the day");
  assert.equal(copyBudgetIssue({ perDaySol: 250, sharePct: 25, days: 30 }), null);
  assert.equal(copyBudgetIssue({ perDaySol: 0.005, sharePct: 10, days: 7 }), "tradeMin", "a trade the network's fee outweighs is not one");
  assert.equal(copyBudgetIssue({ perDaySol: 1, sharePct: 33, days: 7 }), "buys", "only the shares the form offers");
  assert.equal(copyBudgetIssue({ perDaySol: 1, sharePct: 25, days: 0 }), "term");
  const terms = copyTermsOf({ perDaySol: 1, sharePct: 10, days: 7 }, iso(S0));
  assert.equal(terms.perTradeRaw, "100000000");
  assert.equal(terms.endsAt, iso(S0 + 7 * 86_400));
  assert.equal(termDayOf(S0, S0 + 86_399), 0);
  assert.equal(termDayOf(S0, S0 + 86_400), 1);
});

test("the leader's own price; the bound above it; whether it left the coin", () => {
  const buy = trade("buy", 1_000_000, 1, 10);
  assert.equal(leaderPriceSol(buy, SOL_USD), 0.000001);
  assert.equal(leaderPriceSol({ ...buy, quote: "USDC", quoteAmount: 200 }, SOL_USD), 0.000001, "a dollar leg at SOL's price now");
  assert.equal(leaderPriceSol({ ...buy, quote: "USDC", quoteAmount: 200 }, null), null);
  assert.equal(pastBound(0.00000105, 0.000001, 5), false, "5 % above at a bound of 5 % still buys");
  assert.equal(pastBound(0.0000010501, 0.000001, 5), true);
  assert.equal(pastBound(1, null, 5), false, "no leader's price — no bound to hold it to");
  const sale = trade("sell", 1_000_000, 1.2, 20);
  assert.equal(leaderLeft([buy, sale], buy), true);
  assert.equal(leaderLeft([buy, trade("sell", 1, 1, 30, OTHER)], buy), false, "a sale of another coin is no exit of this one");
});

/* ---------------------------------------------------------------- the copy's rules */

test("a buy repeated at her trade — the share of her day; the day's cap stops the next, a new day starts over", () => {
  const copy = agentCopy();
  assert.equal(copy.sizeSol, 0.25);
  const buys = [1, 2, 3, 4, 5].map((n) => trade("buy", 1_000_000, 1, n * 10, `${"C".repeat(43)}${n}`));
  const prices = facts(buys.map((one) => [one.mint, AT_LEADER]));
  const after = fillCopy(copy, buys, prices, SOL_USD, S0 + 100);
  const missed = after.fills.map((fill) => fill.missed);
  assert.deepEqual(missed.reverse(), [null, null, null, null, "budget"], "four quarters of the day, the fifth over it");
  assert.equal(after.agent.daySpentSol, 1);
  assert.ok(Math.abs(after.spentSol - 4 * (0.25 + COPY_NETWORK_SOL)) < 1e-9);
  /* The next day: the day's cap is whole again. */
  const next = trade("buy", 1_000_000, 1, 86_400 + 60, `${"C".repeat(43)}6`);
  const tomorrow = fillCopy(after, [next, ...buys], facts([[next.mint, AT_LEADER]]), SOL_USD, S0 + 86_400 + 120);
  assert.equal(tomorrow.fills[0].missed, null);
  assert.equal(tomorrow.agent.dayN, 1);
  assert.equal(tomorrow.agent.daySpentSol, 0.25);
});

test("the leader's exit never becomes the copy's entry — in the same pass, or after a buy that waited for a price", () => {
  const copy = agentCopy();
  const buy = trade("buy", 1_000_000, 1, 10);
  const sale = trade("sell", 1_000_000, 1.1, 40);
  const both = fillCopy(copy, [sale, buy], facts([[MEME, AT_LEADER]]), SOL_USD, S0 + 100);
  assert.equal(both.fills.length, 1);
  assert.equal(both.fills[0].missed, "exited", "the leader in and out before the copy saw it: no entry");
  assert.deepEqual(both.positions, {}, "nothing held, so the sale sells nothing");
  assert.equal(both.agent.daySpentSol, 0, "a buy not made spends none of the day");
  /* A buy that waited for a price (a source down a minute), and the leader sold meanwhile: still no entry. */
  const waited = fillCopy(copy, [buy], new Map(), SOL_USD, S0 + 60);
  assert.equal(waited.fills.length, 0, "no price: the buy waits, never a miss");
  const later = fillCopy(waited, [sale, buy], facts([[MEME, AT_LEADER]]), SOL_USD, S0 + 120);
  assert.equal(later.fills[0].missed, "exited");
  /* SOL-R3's copy without terms fills as before: the rule is the agent's. */
  const plain = startCopy([], LEADER, { sizeSol: 0.5, slippagePct: 5, name: null }, iso(S0))[0];
  const old = fillCopy(plain, [sale, buy], facts([[MEME, AT_LEADER]]), SOL_USD, S0 + 100);
  assert.equal(old.fills.find((fill) => fill.side === "buy").missed, null);
});

test("the copy's price stays near the leader's: a buy past the bound is not made; a sale is never held back", () => {
  const buy = trade("buy", 1_000_000, 1, 10);
  /* 6 % above the leader's price. */
  const dearer = facts([[MEME, AT_LEADER * 1.06, 1e9]]);
  assert.equal(fillCopy(agentCopy(), [buy], dearer, SOL_USD, S0 + 60).fills[0].missed, "drift");
  const wide = fillCopy(agentCopy({ slippagePct: 15 }), [buy], dearer, SOL_USD, S0 + 60);
  assert.equal(wide.fills[0].missed, null, "a wider bound buys");
  assert.deepEqual([...COPY_BOUNDS], [1, 5, 15]);
  /* Its own size moves the pool too: counted in the price the bound holds. */
  const thin = facts([[MEME, AT_LEADER * 1.03, 2 * 0.25 * SOL_USD * 25]]);
  assert.equal(fillCopy(agentCopy(), [buy], thin, SOL_USD, S0 + 60).fills[0].missed, "drift", "3 % dearer and 4 % of impact: past 5 %");
  /* Bought; the price halves; the leader sells — the copy sells too, at half. */
  const sale = trade("sell", 1_000_000, 0.5, 200);
  const sold = fillCopy(wide, [sale, buy], facts([[MEME, AT_LEADER / 2, 1e9]]), SOL_USD, S0 + 260);
  assert.equal(sold.fills[0].side, "sell");
  assert.equal(sold.fills[0].missed, null);
  assert.deepEqual(sold.positions, {});
});

test("after the term no more buys; the copy's sales go on", () => {
  const copy = agentCopy({ days: 7 });
  const buy = trade("buy", 1_000_000, 1, 10);
  const held = fillCopy(copy, [buy], facts([[MEME, AT_LEADER]]), SOL_USD, S0 + 60);
  const end = S0 + 7 * 86_400;
  const late = trade("buy", 1_000_000, 1, 7 * 86_400 + 10, OTHER);
  const sale = trade("sell", 1_000_000, 1, 7 * 86_400 + 20);
  const after = fillCopy(held, [sale, late, buy], facts([[MEME, AT_LEADER], [OTHER, AT_LEADER]]), SOL_USD, end + 60);
  const by = Object.fromEntries(after.fills.slice(0, 2).map((fill) => [fill.side, fill.missed]));
  assert.deepEqual(by, { buy: "ended", sell: null });
  assert.ok(PAPER_LATE_S > 60);
});

test("stored as the paper copies are: her terms kept, a restart keeps the day already spent; no terms — SOL-R3's sizes only", async () => {
  const store = createMemoryGuardStore();
  const at = iso(S0);
  const terms = copyTermsOf({ perDaySol: 3.7, sharePct: 10, days: 30 }, at);
  const first = await changePaper(store, OWNER, (copies) => startAgentCopy(copies, LEADER, { terms, slippagePct: 5, name: "Кит" }, at), at);
  assert.equal(first.ok, true);
  const kept = (await readPaper(store, OWNER)).copies[0];
  assert.equal(kept.sizeSol, 0.37, "any trade the budget took — not one of SOL-R3's sizes");
  assert.equal(kept.agent.perDayRaw, "3700000000");
  /* A day's spend, then a restart with new numbers: the same copy, the day's spend stays. */
  const spent = fillCopy(kept, [trade("buy", 1_000_000, 1, 10)], facts([[MEME, AT_LEADER]]), SOL_USD, S0 + 60);
  assert.equal(spent.agent.daySpentSol, 0.37);
  const restarted = startAgentCopy([spent], LEADER, { terms: copyTermsOf({ perDaySol: 1, sharePct: 50, days: 7 }, iso(S0 + 600)), slippagePct: 15, name: null }, iso(S0 + 600))[0];
  assert.equal(restarted.since, at);
  assert.equal(restarted.name, "Кит");
  assert.equal(restarted.sizeSol, 0.5);
  assert.equal(restarted.agent.daySpentSol, 0.37, "a restart is no new day's budget");
  assert.equal(Object.keys(restarted.positions).length, 1, "its holdings stay");
  /* SOL-R3's start over an agent's copy: the terms go with it. */
  assert.equal(startCopy([restarted], LEADER, { sizeSol: 1, slippagePct: 5, name: null }, at)[0].agent, undefined);
  /* A copy without terms of a size SOL-R3 does not offer is no copy. */
  const raw = { schema: "ryntra.wallet-watch.paper", version: 9, owner: OWNER, updatedAt: at, copies: [{ ...restarted, agent: undefined, sizeSol: 0.37 }] };
  const bad = createMemoryGuardStore();
  await bad.versioned("walletWatch").compareAndSet(`paper:solana:mainnet:${OWNER}`, null, JSON.parse(JSON.stringify(raw)));
  assert.equal(await readPaper(bad, OWNER), null);
});

/* ---------------------------------------------------------------- the month's fees */

test("the month's fees before she starts: the leader's pace, at most her day's trades, each buy and its sale", () => {
  const nowS = S0 + 10 * 86_400;
  const trades = Array.from({ length: 30 }, (_, i) => trade("buy", 1, 0.1, i * 8 * 3_600, MEME));
  const fees = copyMonthFees({ trades, oldestAt: S0, nowS, perTradeSol: 0.25, perDaySol: 1 });
  assert.ok(Math.abs(fees.leaderPerDay - 3) < 1e-9, "thirty buys in ten days");
  assert.equal(fees.copiesPerDay, fees.leaderPerDay);
  assert.equal(fees.feeBps, 100, "a meme's fee by the fee policy");
  const perCopy = 0.25 * 0.01 * 2 + COPY_NETWORK_SOL * 2;
  assert.ok(Math.abs(fees.sol - 30 * 3 * perCopy) < 1e-9);
  /* A wallet that buys forty times an hour: the copy makes at most what her day holds. */
  const busy = Array.from({ length: 40 }, (_, i) => trade("buy", 1, 0.1, 9 * 86_400 + i * 60));
  const capped = copyMonthFees({ trades: busy, oldestAt: S0 + 9 * 86_400, nowS: S0 + 9 * 86_400 + 3_600, perTradeSol: 0.25, perDaySol: 1 });
  assert.equal(capped.copiesPerDay, 4);
  assert.ok(capped.leaderPerDay > 900);
  assert.equal(copyMonthFees({ trades: [], oldestAt: null, nowS, perTradeSol: 0.25, perDaySol: 1 }), null, "nothing read — nothing said");
  assert.equal(copyMonthFees({ trades, oldestAt: S0, nowS, perTradeSol: 2, perDaySol: 1 }), null);
  const quiet = copyMonthFees({ trades: [], oldestAt: S0, nowS, perTradeSol: 0.25, perDaySol: 1 });
  assert.equal(quiet.sol, 0, "a wallet that bought nothing: no fees");
});

/* ---------------------------------------------------------------- the cron: Helius's credits, the rehearsal */

const REHEARSAL = JSON.parse(read("lib/wallet-watch/fixtures/copy-rehearsal-2026-11-21.json"));

/** The node of the rehearsal: each pass lists only what its page holds, each transaction as the node gave it. */
function rehearsalChain(pass, calls = { n: 0 }) {
  return {
    calls,
    async signatures(_address, options) {
      calls.n += 1;
      /* The pass's page holds what came since the pass before: everything newer than `until`. */
      const page = REHEARSAL.passes[pass.at].getSignaturesForAddress;
      const stop = options.until ? page.findIndex((row) => row.signature === options.until) : -1;
      const rows = stop >= 0 ? page.slice(0, stop) : page;
      return { rows: rows.map((row) => ({ signature: row.signature, slot: row.slot, blockTime: row.blockTime, failed: row.err !== null })), whole: true };
    },
    async transaction(signature) {
      calls.n += 1;
      return REHEARSAL.getTransaction[signature] ?? null;
    },
    async holdings() {
      calls.n += 3;
      return new Map();
    },
  };
}
const rehearsalFacts = (pass) => async (mints) =>
  new Map(
    mints.map((mint) => [
      mint,
      mint === WRAPPED_SOL ? { symbol: "SOL", name: "SOL", icon: null, priceUsd: REHEARSAL.solUsd, creator: null, createdAt: null } : { symbol: "M", name: "M", icon: null, priceUsd: REHEARSAL.passes[pass.at].prices[mint] ?? null, liquidityUsd: REHEARSAL.liquidityUsd, creator: null, createdAt: null },
    ]),
  );

test("rehearsal on the node's answers: three passes of the cron — filled, exited, half sold, past the bound, the day's cap", async () => {
  const store = createMemoryGuardStore();
  const at = iso(REHEARSAL.startedAt);
  const terms = copyTermsOf({ perDaySol: 1, sharePct: 25, days: 7 }, at);
  await changePaper(store, OWNER, (copies) => startAgentCopy(copies, REHEARSAL.leader, { terms, slippagePct: 5, name: null }, at), at);
  const spent = [];
  const copyReads = { allows: () => true, spend: (credits) => spent.push(credits) };
  for (let i = 0; i < REHEARSAL.passes.length; i += 1) {
    const pass = { at: i };
    const report = await runWalletWatchPass({ store, chain: rehearsalChain(pass), facts: rehearsalFacts(pass), clock: () => REHEARSAL.passes[i].at * 1000, copyReads });
    assert.equal(report.notes, 0, "a paper copy rings nothing");
  }
  const copy = (await readPaper(store, OWNER)).copies[0];
  const coin = (letter) => REHEARSAL.coins[letter];
  const by = copy.fills
    .slice()
    .reverse()
    .map((fill) => [Object.keys(REHEARSAL.coins).find((letter) => coin(letter) === fill.mint), fill.side, fill.missed]);
  assert.deepEqual(by, [
    ["A", "buy", null],
    ["B", "buy", null],
    ["C", "buy", "exited"],
    ["A", "sell", null],
    ["B", "buy", "drift"],
    ["D", "buy", null],
    ["E", "buy", null],
    ["F", "buy", "budget"],
  ]);
  assert.ok(Math.abs(copy.positions[coin("A")].tokens / copy.positions[coin("B")].tokens - 0.5 * (1 / 1.01)) < 0.01, "half of A sold, as the leader sold half");
  assert.equal(copy.agent.daySpentSol, 1, "four quarters of her day");
  assert.equal(spent.length, 3, "each pass's calls paid");
  assert.ok(spent.every((credits) => credits > 0 && credits % COPY_CALL_CREDITS === 0));
  const summary = paperSummary(copy, new Map(Object.values(REHEARSAL.coins).map((mint) => [mint, REHEARSAL.passes[2].prices[mint] ?? null])), REHEARSAL.solUsd);
  assert.equal(summary.filled, 5);
  assert.equal(summary.missed, 3);
});

test("a wallet read for its copies alone waits once the day's credits are spent; one someone follows is read as before", async () => {
  const store = createMemoryGuardStore();
  const at = iso(REHEARSAL.startedAt);
  await changePaper(store, OWNER, (copies) => startAgentCopy(copies, REHEARSAL.leader, { terms: copyTermsOf({ perDaySol: 1, sharePct: 25, days: 7 }, at), slippagePct: 5, name: null }, at), at);
  const asked = [];
  const shut = { allows: (credits) => (asked.push(credits), false), spend: () => assert.fail("nothing read, nothing paid") };
  const chain = rehearsalChain({ at: 0 });
  const report = await runWalletWatchPass({ store, chain, facts: rehearsalFacts({ at: 0 }), clock: () => REHEARSAL.passes[0].at * 1000, copyReads: shut });
  assert.equal(report.copyCapped, 1);
  assert.equal(report.read, 0);
  assert.equal(chain.calls.n, 0, "the node is not asked");
  assert.deepEqual(asked, [COPY_READ_WORST], "its worst cost asked first");
  assert.equal(COPY_READ_WORST, (1 + 25) * COPY_CALL_CREDITS, "its list and new transactions — never its holdings");
  const server = read("lib/wallet-watch/copy-reads.server.ts");
  assert.match(server, /RYNTRA_AGENT_COPY_DAILY_CREDITS/);
  assert.match(server, /COPY_DAILY_CREDITS = 60_000/);
  assert.match(read("lib/wallet-watch/runtime.server.ts"), /copyReads: copyReads\(\)/, "production passes the ceiling");
});

test("lead's review of #1966: SOL-R3's copies are read past the ceiling, an agent's copy never asks holdings, an ended leader is not read", async () => {
  const at = iso(REHEARSAL.startedAt);
  const clock = () => REHEARSAL.passes[0].at * 1000;
  const shut = { allows: () => false, spend: () => assert.fail("a SOL-R3 read is not paid from the copies' day") };
  /* A leader SOL-R3 copies (no agent's terms): the ceiling, even spent, does not hold it. */
  const classic = createMemoryGuardStore();
  await changePaper(classic, OWNER, (copies) => startCopy(copies, REHEARSAL.leader, { sizeSol: 0.1, slippagePct: 5, name: null }, at), at);
  const seen = rehearsalChain({ at: 0 });
  const first = await runWalletWatchPass({ store: classic, chain: seen, facts: rehearsalFacts({ at: 0 }), clock, copyReads: shut });
  assert.equal(first.copyCapped, 0);
  assert.equal(first.read, 1);
  assert.ok(seen.calls.n > 0, "the node is asked");
  /* A leader copied by an agent alone: read, paid, and its holdings never asked. */
  const agent = createMemoryGuardStore();
  await changePaper(agent, OWNER, (copies) => startAgentCopy(copies, REHEARSAL.leader, { terms: copyTermsOf({ perDaySol: 1, sharePct: 25, days: 7 }, at), slippagePct: 5, name: null }, at), at);
  const chain = rehearsalChain({ at: 0 });
  let asked = 0;
  chain.holdings = async () => ((asked += 1), new Map());
  const paid = [];
  await runWalletWatchPass({ store: agent, chain, facts: rehearsalFacts({ at: 0 }), clock, copyReads: { allows: () => true, spend: (credits) => paid.push(credits) } });
  assert.equal(asked, 0, "holdings are not read for a copy");
  assert.equal(paid.reduce((sum, credits) => sum + credits, 0), chain.calls.n * COPY_CALL_CREDITS, "what it asked is what it paid");
  /* Its term over and nothing held: the leader is not read at all. */
  const ended = createMemoryGuardStore();
  const long = iso(REHEARSAL.startedAt - 8 * 86_400);
  await changePaper(ended, OWNER, (copies) => startAgentCopy(copies, REHEARSAL.leader, { terms: copyTermsOf({ perDaySol: 1, sharePct: 25, days: 7 }, long), slippagePct: 5, name: null }, long), long);
  const quiet = rehearsalChain({ at: 0 });
  const none = await runWalletWatchPass({ store: ended, chain: quiet, facts: rehearsalFacts({ at: 0 }), clock, copyReads: { allows: () => assert.fail("not even asked"), spend: () => assert.fail("nothing paid") } });
  assert.equal(none.wallets, 0);
  assert.equal(quiet.calls.n, 0);
});

test("an agent's copy past its term keeps its leader read only a week while it holds coins", async () => {
  const { agentCopyLive, COPY_AFTER_TERM_MS } = await import("./run.ts");
  const ends = Date.parse("2026-11-21T00:00:00.000Z");
  const copy = (positions) => ({ agent: { endsAt: new Date(ends).toISOString() }, positions });
  const held = { [REHEARSAL.leader]: { tokens: 1, costSol: 0.1 } };
  assert.equal(agentCopyLive(copy({}), ends - 1), true, "inside its term");
  assert.equal(agentCopyLive(copy({}), ends + 1), false, "past it, nothing held");
  assert.equal(agentCopyLive(copy(held), ends + COPY_AFTER_TERM_MS - 1), true, "a week past it, still holding");
  assert.equal(agentCopyLive(copy(held), ends + COPY_AFTER_TERM_MS + 1), false, "past the week");
  assert.equal(agentCopyLive({ positions: held }, ends), false, "a copy of SOL-R3 is not an agent's");
});

/* ---------------------------------------------------------------- money: closed */

test("money stays behind its switch: the signer has its rule, the start is wired, only `on` opens it", () => {
  assert.equal(COPY_SIGNER_READY, true);
  assert.equal(COPY_START_READY, true);
  assert.equal(copyMoneyOpen("on"), true);
  assert.equal(copyMoneyOpen(undefined), false);
  assert.equal(copyMoneyOpen(""), false);
  assert.equal(copyMoneyOpen("true"), false);
  /* The paper route never starts money: closed — MONEY_CLOSED; open — its own door (`./money/**`). */
  const route = read("app/api/wallet-watch/copy/route.ts");
  assert.match(route, /if \(input\.money === true\) return moneyOpen\(\) \? json\(\{ error: "bad request", code: "MONEY_ROUTE" \}, 400\) : json\(\{ error: "closed", code: "MONEY_CLOSED" \}, 403\)/);
  for (const file of ["lib/wallet-watch/copy-agent.ts", "lib/wallet-watch/paper.ts", "lib/wallet-watch/copy-reads.server.ts", "app/api/wallet-watch/copy/route.ts"]) {
    assert.doesNotMatch(read(file), /sendTransaction|sendRawTransaction|signTransaction|signAllTransactions|jupiter\/order|\/execute|Keypair|secretKey|signMessage/, `${file} must not trade or sign`);
  }
  /* The mandate's signer and its policies are used, never changed here. */
  assert.doesNotMatch(read("lib/wallet-watch/copy-agent.ts"), /from "\.\.\/mandate\/(?!budget\.ts)/);
});
