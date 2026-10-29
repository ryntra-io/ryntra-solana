// SOL-R3 «Копіювання гаманців з реальністю послідовника» (порада ззовні 18.10): before copying — what a follower would
// have kept after the delay of their entry, the pool's depth, fees, failed transactions and slippage, not «the wallet
// made 400 %»; paper first; live copying only after the legal opinion (D12) and the owner's canary — not built.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { changePaper, fillCopy, PAPER_LATE_S, PAPER_LIMIT, paperSummary, readPaper, startCopy, stopCopy } from "./paper.ts";
import { barsNear, pathPool, pathWidth, PATH_REACH_S } from "./paths.ts";
import { COPY_ASSUMPTIONS, followerReality, priceAt, rangeAt, REALITY_STEPS, ryntraFeeBps } from "./reality.ts";
import { runWalletWatchPass } from "./run.ts";
import { WRAPPED_SOL } from "./trades.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const LEADER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OWNER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MEME = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const OTHER = "Dp3JBaPCdx3N7Xx9gsQVcE9WDAmCEQ5HyfTdrDoXpump";
const S0 = Date.parse("2026-10-21T12:00:00Z") / 1000;
const SOL_USD = 200;

let slot = 1_000;
/** A leader's trade against SOL: whole tokens (6 decimals), SOL paid or got, seconds from S0. */
const trade = (side, tokens, sol, at, mint = MEME, extra = {}) => ({
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
  ...extra,
});

/** Minute bars in dollars from S0 − 10 min: `price(t)` gives each bar's open and close, a share of range for high/low. */
function minutePath(price, { minutes = 400, range = 0, readAt } = {}) {
  const bars = [];
  for (let i = -10; i < minutes; i += 1) {
    const t = S0 + i * 60;
    const open = price(t);
    const close = price(t + 60);
    bars.push([t, open, Math.max(open, close) * (1 + range / 2), Math.min(open, close) * (1 - range / 2), close]);
  }
  return { barSeconds: 60, bars, pool: "MEME / SOL", dex: "pumpswap", readAt };
}

/* A meme that runs from $0.0001 to $0.0005 over five hours, linearly: the leader buys at the start and sells at five times. */
const RUN = (t) => 0.0001 * (1 + (4 * Math.max(0, t - S0)) / (5 * 3_600));
const LEADER_TRADES = [trade("buy", 2_000_000, 1, 0), trade("sell", 2_000_000, 5, 5 * 3_600)];
const NOW = new Map([[MEME, { priceUsd: 0.0005, liquidityUsd: 40_000 }]]);

test("the pool's price at a moment: inside a bar from open to close; a quiet gap keeps the last close; past the read — nothing", () => {
  const path = { barSeconds: 60, bars: [[S0, 1, 1.2, 0.9, 2], [S0 + 600, 3, 3, 3, 3]], pool: null, dex: null };
  assert.equal(priceAt(path, S0 + 30), 1.5);
  assert.equal(priceAt(path, S0 + 300), 2, "no trades for minutes: the last close stands");
  assert.equal(priceAt(path, S0 - 1), null, "before the first bar: not known");
  assert.equal(priceAt(path, S0 + 600 + 59), 3);
  assert.equal(priceAt(path, S0 + 900), null, "past the last bar: the read does not reach there");
  assert.equal(priceAt({ ...path, readAt: S0 + 1_000 }, S0 + 900), 3, "read later: a quiet end is the market resting");
  assert.ok(Math.abs(rangeAt(path, S0 + 10) - 0.3) < 1e-12);
  assert.equal(rangeAt(path, S0 + 300), 0);
});

test("with nothing lost the follower makes the wallet's percent at its own size; each loss then takes its share", () => {
  const reality = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(RUN)]]), now: NOW, solUsd: SOL_USD }, { sizeSol: 1, delaySeconds: 30, slippagePct: 15 });
  assert.equal(Math.round(reality.leader.pct), 400, "the wallet made 400 %");
  assert.equal(Math.round(reality.ideal.pct), 400, "the same trades at the follower's size, nothing lost");
  assert.deepEqual(Object.keys(reality.steps), [...REALITY_STEPS]);
  for (const step of REALITY_STEPS) assert.ok(reality.steps[step] <= 1e-9, `${step} takes, never gives: ${reality.steps[step]}`);
  assert.ok(reality.steps.delay < 0, "a rising market costs the late buyer");
  assert.ok(reality.steps.liquidity < 0, "1 SOL moves a $40k pool");
  assert.ok(reality.steps.fees < 0);
  assert.ok(reality.follower.pct < reality.leader.pct);
  const sum = REALITY_STEPS.reduce((total, step) => total + reality.steps[step], reality.ideal.resultSol);
  assert.ok(Math.abs(sum - reality.follower.resultSol) < 1e-9, "the breakdown adds up to what the follower kept");
  assert.equal(reality.copiedBuys, 1);
  assert.equal(reality.unmeasured.length, 0);
});

test("delay: the follower buys at the pool's price the seconds later, against the leader's own fill", () => {
  const settings = { sizeSol: 0.1, delaySeconds: 120, slippagePct: 15 };
  const flat = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(() => 0.0001)]]), now: NOW, solUsd: SOL_USD }, settings);
  assert.ok(Math.abs(flat.steps.delay) < 1e-9, "a market that did not move costs no delay");
  /* A pump: the price doubles in the two minutes after the leader's buy, and stays. */
  const pump = (t) => (t < S0 ? 0.0001 : t < S0 + 120 ? 0.0001 * (1 + (t - S0) / 120) : 0.0002 * (1 + (1.5 * (t - S0 - 120)) / (5 * 3_600 - 120)));
  const late = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(pump)]]), now: NOW, solUsd: SOL_USD }, settings);
  const ideal = late.ideal.resultSol;
  /* Bought at twice the leader's price: half the tokens — the 400 % is about 150 % before any other loss. */
  const afterDelay = ideal + late.steps.delay;
  assert.ok(Math.abs(afterDelay / 0.1 - 1.5) < 0.05, `after delay ≈ +150 %: ${(afterDelay / 0.1) * 100}`);
});

test("liquidity: never a miss and never past the tolerance — a rug stays a loss, a dead token stays in the figure", () => {
  const thin = new Map([[MEME, { priceUsd: 0.0005, liquidityUsd: 2_000 }]]);
  /* $1 000 a side now; at the buy (price ×5 lower) the pool was √5 shallower: 1 SOL is past 5 % — held at the tolerance. */
  const reality = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(RUN)]]), now: thin, solUsd: SOL_USD }, { sizeSol: 1, delaySeconds: 5, slippagePct: 5 });
  assert.equal(reality.copiedBuys, 1, "copied, its impact charged whole");
  assert.equal(reality.capped, 1, "said: as sent, this swap would fail");
  assert.ok(reality.steps.liquidity < 0);
  /* A tighter tolerance, or a thinner pool, never makes the figure better. */
  const kept = (slippagePct, liquidityUsd) => followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(RUN)]]), now: new Map([[MEME, { priceUsd: 0.0005, liquidityUsd }]]), solUsd: SOL_USD }, { sizeSol: 5, delaySeconds: 30, slippagePct }).follower.resultSol;
  assert.ok(kept(1, 40_000) <= kept(15, 40_000) + 1e-9, `${kept(1, 40_000)} vs ${kept(15, 40_000)}`);
  assert.ok(kept(15, 400) < kept(15, 4_000) && kept(15, 4_000) < kept(15, 40_000), "a $400 pool costs more than a $40k one");
  /* With a moving price (a 20 % bar) and a losing trade, a thinner pool never turns the loss into a miss. */
  const halves = (t) => (t < S0 + 600 ? 0.0002 : 0.0001);
  const losing = [trade("buy", 5_000, 1, 0), trade("sell", 5_000, 0.5, 3_600)];
  const lost = (liquidityUsd) => followerReality({ trades: losing, paths: new Map([[MEME, minutePath(halves, { range: 0.2 })]]), now: new Map([[MEME, { priceUsd: 0.0001, liquidityUsd }]]), solUsd: SOL_USD }, { sizeSol: 1, delaySeconds: 30, slippagePct: 5 });
  let previous = Infinity;
  for (const liquidity of [30_000, 20_000, 12_000, 8_000, 4_000, 1_000]) {
    const run = lost(liquidity);
    assert.equal(run.copiedBuys, 1, `$${liquidity}: copied, never missed for depth`);
    assert.ok(run.follower.resultSol <= previous + 1e-12, `$${liquidity}: ${run.follower.resultSol} after ${previous}`);
    previous = run.follower.resultSol;
  }
  /* A rug: the leader lost 99 %, the pool is $100 now — the follower loses too, never «Pool depth +0.5 SOL». */
  const rug = followerReality({ trades: [trade("buy", 1_000_000, 1, 0)], paths: new Map([[MEME, minutePath(() => 0.0002)]]), now: new Map([[MEME, { priceUsd: 0.000001, liquidityUsd: 100 }]]), solUsd: SOL_USD }, { sizeSol: 0.5, delaySeconds: 5, slippagePct: 15 });
  assert.equal(rug.unmeasured.length, 0);
  assert.ok(rug.steps.liquidity <= 0);
  assert.ok(rug.follower.pct < -95, `${rug.follower.pct}`);
  /* Survivorship: a winner and a dead token with no price now — the figure keeps the dead one, at zero. */
  const dead = "Dead1111111111111111111111111111111111111111";
  const both = followerReality({ trades: [trade("buy", 1_000, 1, 0), trade("sell", 1_000, 2, 3_600), trade("buy", 1_000, 3, 60, dead)], paths: new Map([[MEME, minutePath(() => 0.2)], [dead, minutePath(() => 0.6)]]), now: new Map([[MEME, { priceUsd: 0.2, liquidityUsd: null }]]), solUsd: SOL_USD });
  assert.equal(both.noPriceNow, 1);
  assert.ok(Math.abs(both.leader.pct - -50) < 1e-9, `the wallet: +1 on one, −3 on the dead one, of 4 SOL — ${both.leader.pct}`);
  const unknown = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(RUN)]]), now: new Map([[MEME, { priceUsd: 0.0005, liquidityUsd: null }]]), solUsd: SOL_USD });
  assert.equal(unknown.liquidityUnknown, 1, "liquidity not known is said, not taken as deep");
});

test("a sale that does not land is worth no more than it would have got — a price that rose since is not the follower's", () => {
  /* Buy at 1×, sell all at 5× in a wild top (40 % bars); today the price is 4× the sale's. */
  const top = (t) => (t < S0 + 3_600 ? 0.0001 : 0.0005);
  const trades = [trade("buy", 1_000_000, 0.5, 0), trade("sell", 1_000_000, 2.5, 3_600 + 60)];
  /* Calm at the buy, wild only around the top. */
  const calm = minutePath(top);
  const path = { ...calm, bars: calm.bars.map(([t, o, h, l, c]) => (t >= S0 + 3_500 && t <= S0 + 4_000 ? [t, o, h * 1.2, l * 0.8, c] : [t, o, h, l, c])) };
  const run = (slippagePct) => followerReality({ trades, paths: new Map([[MEME, path]]), now: new Map([[MEME, { priceUsd: 0.002, liquidityUsd: null }]]), solUsd: SOL_USD }, { sizeSol: 0.5, delaySeconds: 5, slippagePct });
  const tight = run(1);
  assert.equal(tight.stuckSales, 1);
  assert.ok(tight.follower.pct <= tight.leader.pct, `stuck: ${tight.follower.pct} vs the wallet's ${tight.leader.pct}`);
  assert.ok(tight.steps.slippage <= 1e-9, `the slippage line never shows a gain: ${tight.steps.slippage}`);
});

test("failing to sell is never worth more than selling: a thin pool, a wild bar, a tight tolerance", () => {
  /* Flat price, $2 000 pool now, 5 SOL, a 30 % bar at the sale: at 1 % the sale fails, at 15 % it lands. */
  const flat = minutePath(() => 0.0001);
  const path = { ...flat, bars: flat.bars.map(([t, o, h, l, c]) => (t >= S0 + 3_500 && t <= S0 + 4_000 ? [t, o, h * 1.15, l * 0.85, c] : [t, o, h, l, c])) };
  const trades = [trade("buy", 1_000_000, 0.1, 0), trade("sell", 1_000_000, 0.1, 3_600 + 60)];
  const run = (slippagePct) => followerReality({ trades, paths: new Map([[MEME, path]]), now: new Map([[MEME, { priceUsd: 0.0001 * 200 / 10, liquidityUsd: 2_000 }]]), solUsd: SOL_USD }, { sizeSol: 5, delaySeconds: 5, slippagePct });
  const tight = run(1);
  const loose = run(15);
  assert.equal(tight.stuckSales, 1);
  assert.equal(loose.stuckSales, 0);
  assert.ok(tight.steps.slippage <= 1e-9, `${tight.steps.slippage}`);
  assert.ok(tight.follower.resultSol <= loose.follower.resultSol + 0.05, `${tight.follower.resultSol} vs ${loose.follower.resultSol}`);
});

test("a sale that did not land stays held: the leader's next, lower sale sells it too — the price now never rescues it", () => {
  /* Buy 2M for 1 SOL at $1e-4; half sold at $5e-4 in a wild bar (fails at 1 %); the rest at $1e-4; today $6e-4. */
  const level = (t) => (t < S0 + 3_500 ? 0.0001 : t < S0 + 7_000 ? 0.0005 : 0.0001);
  const calm = minutePath(level);
  const path = { ...calm, bars: calm.bars.map(([t, o, h, l, c]) => (t >= S0 + 3_500 && t <= S0 + 3_800 ? [t, o, h * 1.25, l * 0.75, c] : [t, o, h, l, c])) };
  const trades = [trade("buy", 2_000_000, 1, 0), trade("sell", 1_000_000, 2.5, 3_600), trade("sell", 1_000_000, 0.5, 7_200)];
  const reality = followerReality({ trades, paths: new Map([[MEME, path]]), now: new Map([[MEME, { priceUsd: 0.0006, liquidityUsd: null }]]), solUsd: SOL_USD }, { sizeSol: 1, delaySeconds: 5, slippagePct: 1 });
  assert.equal(reality.stuckSales, 1);
  /* All of it sold at the bottom: about −1 %, never +183 %. */
  assert.ok(reality.follower.resultSol < 0.01, `${reality.follower.resultSol}`);
});

test("a retry that lands after the price bounced back gains nothing: the fill is the worst moment tried", () => {
  /* The price crashes for the follower's first tries at the sale and recovers by the third. */
  const dip = (t) => (t >= S0 + 3_600 && t < S0 + 3_630 ? 0.0001 : t < S0 + 3_000 ? 0.0001 : 0.0002);
  const path = { ...minutePath(dip), bars: minutePath(dip).bars.map(([t, o, h, l, c]) => (t >= S0 + 3_540 && t <= S0 + 3_660 ? [t, o, h * 1.15, l * 0.85, c] : [t, o, h, l, c])) };
  const trades = [trade("buy", 1_000_000, 0.1, 0), trade("sell", 1_000_000, 0.2, 3_600)];
  const run = (slippagePct) => followerReality({ trades, paths: new Map([[MEME, path]]), now: new Map([[MEME, { priceUsd: 0.0002, liquidityUsd: null }]]), solUsd: SOL_USD }, { sizeSol: 0.1, delaySeconds: 5, slippagePct });
  for (const pct of [1, 5]) assert.ok(run(pct).steps.slippage <= 1e-9, `${pct} %: ${run(pct).steps.slippage}`);
  for (const step of ["delay", "liquidity", "slippage", "fees", "failures"]) assert.ok(run(15).steps[step] <= 1e-9, `${step}: ${run(15).steps[step]}`);
});

test("a sale at the top met a deeper pool than the one drained since: depth scales by √(price then ÷ price now)", () => {
  /* Bought at 1×, sold at 10×; the pool is $3 000 now at 1×. At the sale it held √10 × as much. */
  const top = (t) => (t < S0 + 3_600 ? 0.0001 : 0.001);
  const trades = [trade("buy", 1_000_000, 0.5, 0), trade("sell", 1_000_000, 5, 3_600 + 60)];
  const reality = followerReality({ trades, paths: new Map([[MEME, minutePath(top)]]), now: new Map([[MEME, { priceUsd: 0.0001, liquidityUsd: 3_000 }]]), solUsd: SOL_USD }, { sizeSol: 0.5, delaySeconds: 5, slippagePct: 15 });
  /* Today's 7.5 SOL a side would cost the 5 SOL sale half its value; √10 deeper at the sale, it costs about half as much. */
  const today = 5 * (1 - 1 / (1 + 5 / 7.5));
  assert.ok(-reality.steps.liquidity < today * 0.6, `${reality.steps.liquidity} vs ${-today}`);
  assert.ok(reality.follower.pct > 600, `the follower keeps most of a 10× — ${reality.follower.pct}`);
});

test("a SOL figure of 150 prints, never throws", async () => {
  const { solText } = await import("../../app/app/markets/wallets/sol-text.ts");
  assert.equal(solText(150.25, "en-US", true), "+150.3");
  assert.equal(solText(-0.00021, "uk-UA"), "−0,00021");
  assert.equal(solText(1.5, "en-US"), "1.50");
});

test("slippage: a wild bar fails the attempt; three failed attempts miss the buy and still pay the network", () => {
  const wild = minutePath(RUN, { range: 0.6 });
  /* 60 % range in a minute → ~11 % while landing: past 5 %, inside 15 %. */
  const tight = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, wild]]), now: NOW, solUsd: SOL_USD }, { sizeSol: 0.1, delaySeconds: 5, slippagePct: 5 });
  assert.equal(tight.missedSlippage, 1);
  assert.ok(tight.follower.resultSol < 0, "missed — and the failed attempts cost their fees");
  const fees = (COPY_ASSUMPTIONS.networkFeeSol + COPY_ASSUMPTIONS.priorityFeeSol) * COPY_ASSUMPTIONS.maxAttempts;
  assert.ok(Math.abs(tight.follower.resultSol + fees) < 1e-12);
  assert.equal(tight.follower.pct, null, "no buy copied: no «−100 %» of three fees");
  assert.equal(tight.tokens[0].follower.pct, null);
  const loose = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, wild]]), now: NOW, solUsd: SOL_USD }, { sizeSol: 0.1, delaySeconds: 5, slippagePct: 15 });
  assert.equal(loose.copiedBuys, 1);
  assert.ok(loose.steps.slippage < 0, "landed — half the landing's move worse");
});

test("fees: Ryntra's by fee policy v2 — a meme 1 %, a major 0.1 % — and the network's on every attempt", () => {
  assert.equal(ryntraFeeBps(MEME), 100);
  assert.equal(ryntraFeeBps(WRAPPED_SOL), 10);
  const flat = followerReality({ trades: LEADER_TRADES.map((row) => ({ ...row, quoteAmount: 1 })), paths: new Map([[MEME, minutePath(() => 0.0001)]]), now: new Map([[MEME, { priceUsd: 0.0001, liquidityUsd: null }]]), solUsd: SOL_USD }, { sizeSol: 1, delaySeconds: 5, slippagePct: 5 });
  /* In and out at the same price: 1 % on the way in, 1 % of what is left on the way out, two transactions' fees. */
  const expected = -(1 - 0.99 * 0.99) - 2 * (COPY_ASSUMPTIONS.networkFeeSol + COPY_ASSUMPTIONS.priorityFeeSol);
  assert.ok(Math.abs(flat.steps.fees - expected) < 1e-9, `${flat.steps.fees} vs ${expected}`);
  assert.ok(flat.steps.failures < 0, "a failed first try: more fees, a later fill");
});

test("the follower sells the leader's share of its position; a sale of what was bought before the read sells all", () => {
  const trades = [trade("buy", 1_000_000, 1, 0), trade("sell", 500_000, 1, 3_600), trade("sell", 500_000, 1.5, 7_200)];
  const reality = followerReality({ trades, paths: new Map([[MEME, minutePath(() => 0.0002)]]), now: new Map([[MEME, { priceUsd: 0.0002, liquidityUsd: null }]]), solUsd: SOL_USD }, { sizeSol: 2, delaySeconds: 5, slippagePct: 15 });
  /* Ideal: half at 2 SOL/M, half at 3 SOL/M — the leader's +150 % at twice the size. */
  assert.ok(Math.abs(reality.ideal.resultSol - 3) < 1e-9, `${reality.ideal.resultSol}`);
  assert.equal(Math.round(reality.leader.pct), 150);
});

test("a gap of hours inside a follower's seconds is no path — never a sale at zero", () => {
  /* Bars until the sale, then nothing for seven hours, then bars again: the sale's 30 s land inside the gap's end. */
  const path = { barSeconds: 60, bars: [[S0 - 600, 1e-4, 1e-4, 1e-4, 1e-4], [S0, 1e-4, 1e-4, 1e-4, 1e-4], [S0 + 25_220, 1e-4, 1e-4, 1e-4, 1e-4], [S0 + 25_280, 1e-4, 1e-4, 1e-4, 1e-4]], pool: null, dex: null, readAt: S0 + 30_000 };
  const trades = [trade("buy", 1_000_000, 0.5, 0), trade("sell", 1_000_000, 0.5, 25_200)];
  const reality = followerReality({ trades, paths: new Map([[MEME, path]]), now: new Map([[MEME, { priceUsd: 1e-4, liquidityUsd: null }]]), solUsd: SOL_USD }, { sizeSol: 0.5, delaySeconds: 30, slippagePct: 15 });
  assert.deepEqual(reality.unmeasured, [{ mint: MEME, reason: "NO_PATH" }]);
});

test("what cannot be measured is said and left out of both sides — never guessed", () => {
  const trades = [...LEADER_TRADES, trade("buy", 10, 1, 60, OTHER), trade("buy", 5, null, 70, OTHER, { quote: null, quoteAmount: null, signature: "tt".padEnd(88, "y") })];
  const reality = followerReality({ trades, paths: new Map([[MEME, minutePath(RUN)]]), now: NOW, solUsd: SOL_USD, unmeasured: [] });
  assert.deepEqual(reality.unmeasured, [{ mint: OTHER, reason: "NO_PATH" }]);
  assert.equal(Math.round(reality.leader.pct), 400, "the unmeasured token is in neither side");
  const noSol = followerReality({ trades: LEADER_TRADES, paths: new Map([[MEME, minutePath(RUN)]]), now: NOW, solUsd: null });
  assert.deepEqual(noSol.unmeasured, [{ mint: MEME, reason: "NO_PRICE_NOW" }], "without SOL's price nothing is in SOL");
  assert.equal(reality.leftOut.tokens, 1);
  assert.equal(reality.leftOut.buySol, 1, "what the wallet put into the left-out token is said");
  /* A buy whose follower's seconds have not passed when the bars were read: measured next time. */
  /* Within GeckoTerminal's lag of the read, too: the bar may not be there yet. */
  const fresh = followerReality({ trades: [trade("buy", 10, 1, 0)], paths: new Map([[MEME, minutePath(RUN, { readAt: S0 + 150 })]]), now: NOW, solUsd: SOL_USD });
  assert.deepEqual(fresh.unmeasured, [{ mint: MEME, reason: "TOO_FRESH" }]);
  assert.equal(fresh.fresh, 1);
  const sold = followerReality({ trades: [trade("sell", 10, 1, 0)], paths: new Map([[MEME, minutePath(RUN)]]), now: NOW, solUsd: SOL_USD });
  assert.deepEqual(sold.unmeasured, [{ mint: MEME, reason: "BOUGHT_BEFORE" }]);
  const paid = followerReality({ trades: [trade("buy", 10, null, 0, MEME, { quote: null, quoteAmount: null })], paths: new Map([[MEME, minutePath(RUN)]]), now: NOW, solUsd: SOL_USD });
  assert.deepEqual(paid.unmeasured, [{ mint: MEME, reason: "NOT_PRICED" }]);
});

test("the pool's bars: the busiest pool against a major — thin or not; the finest width that covers; only the bars near the trades", () => {
  const row = (address, base, quote, volume, reserve) => ({ attributes: { address, name: address, reserve_in_usd: String(reserve), volume_usd: { h24: String(volume) } }, relationships: { base_token: { data: { id: `solana_${base}` } }, quote_token: { data: { id: `solana_${quote}` } }, dex: { data: { id: "pumpswap" } } } });
  const body = { data: [row("P1", MEME, WRAPPED_SOL, 5_000, 3_000), row("P2", MEME, OTHER, 90_000, 90_000), row("P3", WRAPPED_SOL, MEME, 1_000, 50_000)] };
  assert.deepEqual(pathPool(body, MEME), { address: "P1", side: "base", dex: "pumpswap", name: "P1" }, "a $3k pool is what a follower meets — kept");
  assert.equal(pathPool({ data: [row("P2", MEME, OTHER, 1, 1)] }, MEME), null);
  assert.equal(pathWidth([S0, S0 + 3_600]).seconds, 60);
  assert.equal(pathWidth([S0, S0 + 3 * 86_400]).seconds, 300);
  assert.equal(pathWidth([S0, S0 + 30 * 86_400]).seconds, 3_600);
  const list = Array.from({ length: 600 }, (_, i) => [S0 + i * 60, 1, 1, 1, 1, 10]).reverse();
  const near = barsNear({ data: { attributes: { ohlcv_list: list } } }, [S0 + 6_000], 60);
  assert.ok(near.length <= Math.ceil((PATH_REACH_S + 180) / 60) + 3, `${near.length} bars kept`);
  assert.ok(near.some((bar) => bar[0] <= S0 + 6_000) && near.some((bar) => bar[0] >= S0 + 6_000 + PATH_REACH_S));
});

/* ---------------------------------------------------------------- paper */

const FACTS = new Map([[MEME, { priceUsd: 0.0002, liquidityUsd: 40_000, symbol: "MOOCH" }]]);
const copyOf = () => startCopy([], LEADER, { sizeSol: 0.5, slippagePct: 5, name: null }, new Date((S0 - 60) * 1000).toISOString())[0];

test("paper: each new trade filled at the price Ryntra saw — the real delay — once; the leader's share sold", () => {
  const copy = copyOf();
  const trades = [trade("buy", 1_000_000, 0.4, 10), trade("buy", 1, 0.1, -3_600)].reverse();
  const after = fillCopy(copy, trades, FACTS, SOL_USD, S0 + 100);
  assert.equal(after.fills.length, 1, "a trade from before the copy started is not copied");
  const [fill] = after.fills;
  assert.equal(fill.missed, null);
  assert.equal(fill.at - fill.leaderAt, 90, "the delay is the real one: when Ryntra saw it");
  const impact = 0.5 / (40_000 / 2 / SOL_USD);
  assert.ok(Math.abs(fill.tokens - (0.5 * 0.99) / (0.000001 * (1 + impact))) < 1e-6, `${fill.tokens}`);
  assert.equal(fillCopy(after, trades, FACTS, SOL_USD, S0 + 200), after, "a second pass fills nothing twice");
  /* The leader sells half of what it held: the copy sells half. */
  const sold = fillCopy(after, [trade("sell", 500_000, 0.6, 300), ...trades], FACTS, SOL_USD, S0 + 400);
  assert.ok(Math.abs(sold.positions[MEME].tokens / fill.tokens - 0.5) < 1e-5);
  assert.ok(sold.receivedSol > 0);
  const summary = paperSummary(sold, new Map([[MEME, 0.0002]]), SOL_USD);
  assert.ok(summary.resultSol !== null && summary.resultSol < 0, "same price in and out: the fees and the impact are the loss");
  assert.equal(summary.filled, 2);
});

test("paper: a thin pool, no price or a late sight is a miss, said; a sale of nothing held says nothing", () => {
  const copy = copyOf();
  const thin = fillCopy(copy, [trade("buy", 10, 1, 10)], new Map([[MEME, { priceUsd: 0.0002, liquidityUsd: 1_000, symbol: "M" }]]), SOL_USD, S0 + 60);
  assert.equal(thin.fills[0].missed, "liquidity");
  const late = fillCopy(copy, [trade("buy", 10, 1, 10)], FACTS, SOL_USD, S0 + 10 + PAPER_LATE_S + 1);
  assert.equal(late.fills[0].missed, "late");
  const noPrice = fillCopy(copy, [trade("buy", 10, 1, 10)], new Map(), SOL_USD, S0 + 10 + PAPER_LATE_S + 1);
  assert.equal(noPrice.fills[0].missed, "late", "no price until it was too late: missed as late");
  /* A source down for a pass is no miss: the buy waits for the next pass while fresh. */
  const outage = fillCopy(copy, [trade("buy", 10, 1, 10)], FACTS, null, S0 + 60);
  assert.equal(outage, copy);
  /* A buy waiting for a price holds back the same token's sale: the copy never keeps what the leader has left. */
  const quick = [trade("buy", 1_000_000, 0.4, 10), trade("sell", 1_000_000, 0.6, 40)];
  const held1 = fillCopy(copy, quick, new Map(), SOL_USD, S0 + 60);
  assert.equal(held1, copy, "both wait");
  const both = fillCopy(held1, quick, FACTS, SOL_USD, S0 + 180);
  assert.equal(both.positions[MEME], undefined, "bought and sold on the next pass");
  assert.equal(both.filledCount, 2);
  /* Jupiter gives a price and no liquidity: filled, the pool's move unknown — as in the estimate. */
  const noDepth = fillCopy(copy, [trade("buy", 10, 1, 10)], new Map([[MEME, { priceUsd: 0.0002, liquidityUsd: null, symbol: "M" }]]), SOL_USD, S0 + 60);
  assert.equal(noDepth.fills[0].missed, null);
  const nothing = fillCopy(copy, [trade("sell", 10, 1, 10)], FACTS, SOL_USD, S0 + 60);
  assert.equal(nothing.fills.length, 0);
  assert.equal(nothing.seen.length, 1, "handled, so never filled later");
  /* A sale with no price now is tried again while fresh — the copy is not left holding after the leader left. */
  const held = fillCopy(copy, [trade("buy", 1_000_000, 0.4, 10)], FACTS, SOL_USD, S0 + 60);
  const sale = trade("sell", 1_000_000, 0.5, 100);
  const waiting = fillCopy(held, [sale], new Map(), SOL_USD, S0 + 160);
  assert.equal(waiting, held, "nothing changed — no write");
  const sold = fillCopy(waiting, [sale], FACTS, SOL_USD, S0 + 280);
  assert.equal(sold.positions[MEME], undefined, "sold on the next pass");
});

test("paper: up to five copies; started again keeps its history; stopped is gone", async () => {
  const store = createMemoryGuardStore();
  const at = new Date(S0 * 1000).toISOString();
  for (let i = 0; i < PAPER_LIMIT; i += 1) {
    const leader = `${"B".repeat(43)}${"123456789"[i]}`;
    assert.equal((await changePaper(store, OWNER, (copies) => startCopy(copies, leader, { sizeSol: 0.1, slippagePct: 5, name: null }, at), at)).ok, true);
  }
  const over = await changePaper(store, OWNER, (copies) => startCopy(copies, LEADER, { sizeSol: 0.1, slippagePct: 5, name: null }, at), at);
  assert.deepEqual(over, { ok: false, code: "LIMIT" });
  const first = `${"B".repeat(43)}1`;
  const again = await changePaper(store, OWNER, (copies) => startCopy(copies, first, { sizeSol: 1, slippagePct: 15, name: "Кит" }, new Date((S0 + 600) * 1000).toISOString()), at);
  const kept = again.record.copies.find((copy) => copy.leader === first);
  assert.equal(kept.since, at, "the copy's start stays");
  assert.equal(kept.sizeSol, 1);
  assert.equal((await changePaper(store, OWNER, (copies) => stopCopy(copies, first), at)).record.copies.length, PAPER_LIMIT - 1);
  assert.deepEqual(await changePaper(store, OWNER, (copies) => stopCopy(copies, first), at), { ok: false, code: "NOT_FOUND" });
});

test("the cron fills paper copies of a wallet nobody follows for alerts — read once, filled once", async () => {
  const store = createMemoryGuardStore();
  const at = new Date((S0 - 60) * 1000).toISOString();
  await changePaper(store, OWNER, (copies) => startCopy(copies, LEADER, { sizeSol: 0.5, slippagePct: 5, name: null }, at), at);
  const LAMPORTS = 1_000_000_000;
  const buy = {
    slot: 50,
    blockTime: S0 + 10,
    meta: { err: null, fee: 5_000, preBalances: [10 * LAMPORTS, 0], postBalances: [10 * LAMPORTS - 0.4 * LAMPORTS - 5_000 - 2_039_280, 2_039_280], preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: MEME, owner: LEADER, uiTokenAmount: { amount: String(1e12), decimals: 6 } }] },
    transaction: { signatures: ["sigbuy".padEnd(88, "z")], message: { accountKeys: [{ pubkey: LEADER, signer: true }, { pubkey: "Tok3nAcc0unt1111111111111111111111111111111", signer: false }] } },
  };
  const chain = {
    async signatures() {
      return { rows: [{ signature: buy.transaction.signatures[0], slot: 50, blockTime: S0 + 10, failed: false }], whole: true };
    },
    async transaction() {
      return buy;
    },
    async holdings() {
      return new Map();
    },
  };
  const facts = async (mints) => new Map(mints.map((mint) => [mint, mint === WRAPPED_SOL ? { symbol: "SOL", name: "SOL", icon: null, priceUsd: SOL_USD, creator: null, createdAt: null } : { symbol: "MOOCH", name: "M", icon: null, priceUsd: 0.0002, liquidityUsd: 40_000, creator: null, createdAt: null }]));
  const report = await runWalletWatchPass({ store, chain, facts, clock: () => (S0 + 120) * 1000 });
  assert.equal(report.paperFills, 1);
  assert.equal(report.notes, 0, "a paper copy rings nothing");
  const before = await readPaper(store, OWNER);
  const again = await runWalletWatchPass({ store, chain, facts, clock: () => (S0 + 300) * 1000 });
  assert.equal(again.paperFills, 0);
  assert.equal((await readPaper(store, OWNER)).version, before.version, "a quiet pass writes nothing");
  const record = await readPaper(store, OWNER);
  assert.equal(record.copies[0].fills.length, 1);
  assert.equal(record.copies[0].fills[0].at - record.copies[0].fills[0].leaderAt, 110);
});

/* ---------------------------------------------------------- the surface */

test("paper only: nothing of SOL-R3 signs, sends or swaps; live copying is a locked line, not a button", () => {
  for (const file of ["lib/wallet-watch/reality.ts", "lib/wallet-watch/paths.ts", "lib/wallet-watch/paths.server.ts", "lib/wallet-watch/paper.ts", "app/api/wallet-watch/reality/route.ts", "app/api/wallet-watch/paper/route.ts", "app/app/markets/wallets/follower-reality.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /sendTransaction|sendRawTransaction|signTransaction|signAllTransactions|jupiter\/order|\/execute|Keypair|secretKey|useWallet\(|signMessage/, `${file} must not trade or sign`);
  }
  const view = read("app/app/markets/wallets/follower-reality.tsx");
  const fetched = [...view.matchAll(/fetch\(\s*[`"]([^`"]+)/g)].map((m) => m[1].split("?")[0]);
  assert.deepEqual([...new Set(fetched)].sort(), ["/api/wallet-watch/paper", "/api/wallet-watch/reality"]);
  const words = read("app/app/markets/wallets/reality-words.ts");
  assert.match(words, /liveLocked: bi\(\s*"Not open yet\. Live copying comes after a legal review/);
  assert.match(view, /data-live-copy="locked"/);
  assert.doesNotMatch(view.slice(view.indexOf("data-live-copy")), /<Button/, "the live line has no button");
  assert.doesNotMatch(`${view}\n${words}`, /\bRyn\b|RYN /);
  assert.match(read("app/app/markets/wallets/wallet-watch.tsx"), /<FollowerReality /);
});
