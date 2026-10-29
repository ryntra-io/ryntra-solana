import assert from "node:assert/strict";
import test from "node:test";

import { NEVER_PAID, STEP_RULES, judgeHoldersKept, judgePoolWeek, judgeStep, judgeSurvival, judgeVaultCrack, judgeVisitors } from "./points.ts";
import { CREATOR, LAUNCH, MINT, MONDAY, OWNER, addr, at, judged, poolWeek, survivalFacts, visit } from "./fixtures.mjs";
import { judgeCityTrade, NO_CLUSTER_CHECK } from "./honest-count.ts";
import { POINTS } from "../world/catalog.ts";
import { POINTS_REASONS } from "../world/contract.ts";

/*
 * What can never pay points (decisions 71 and 72; `docs/city/ECONOMY.md` §10): trading volume, the number of
 * launches, a paid entry, a trade inside one wallet cluster. Each is tried here against every rule it could reach.
 */

const total = (result) => (result.paid === true ? result.award.points : result.paid === false ? 0 : result.awards.reduce((s, a) => s + a.points, 0));

test("the never-list is the four ways to buy points, and no reason of the world names one of them", () => {
  assert.deepEqual([...NEVER_PAID], ["volume", "launch_count", "paid_entry", "cluster_trade"]);
  for (const reason of POINTS_REASONS) assert.doesNotMatch(reason, /volume|trade|swap|buy|launch|entry|stake|deposit|fee/, reason);
  for (const [reason, rule] of Object.entries(STEP_RULES)) {
    assert.doesNotMatch(rule.key, /amount|usd|volume|count/i, reason);
    assert.ok(rule.points > 0 && Number.isInteger(rule.points), reason);
  }
});

test("volume: a thousand times the money, or a hundred more trades by the same wallets, is the same step", () => {
  const small = survivalFacts({ buyers: 3, dollars: 1 });
  const whale = survivalFacts({ buyers: 3, dollars: 1_000_000 });
  assert.deepEqual(total(judgeSurvival(small)), total(judgeSurvival(whale)));
  const churn = survivalFacts({ buyers: 3, dollars: 25 });
  const wallets = churn.buys.map((b) => b.trade.buyer);
  for (let i = 0; i < 100; i += 1) churn.buys.push(judged({ buyer: wallets[i % 3], when: churn.buys[0].trade.at, dollars: 50_000 }));
  assert.deepEqual(judgeSurvival(churn), judgeSurvival(survivalFacts({ buyers: 3 })), "a hundred buys by three wallets are three buyers");
  assert.deepEqual(judgePoolWeek(poolWeek({ value: 10, dollars: 1 })), judgePoolWeek(poolWeek({ value: 10_000_000, dollars: 10_000_000, fees: 50_000 })));
  // A billion in a pool nobody trades with from outside earns nothing.
  assert.equal(total(judgePoolWeek(poolWeek({ value: 1_000_000_000, cluster: "same" }))), 0);
});

test("launches: launching pays nothing, and a hundred launches in a month pay what three do", () => {
  assert.deepEqual(judgeStep({ kind: "launch", mint: MINT }, "2026-10-27"), { paid: false, why: "not_a_step" });
  assert.deepEqual(judgeStep({ kind: "graduate", mint: MINT }, "2026-10-27"), { paid: false, why: "not_a_step" });
  const pay = (count) => {
    const launches = Array.from({ length: count }, (_, i) => ({ mint: addr(5000 + i), launchedAt: at(LAUNCH, i * 0.2) }));
    let points = 0;
    for (const l of launches) {
      for (const day of [7, 30, 90]) points += total(judgeSurvival(survivalFacts({ day, mint: l.mint, launchedAt: l.launchedAt, monthLaunches: launches })));
      const holders = Array.from({ length: 300 }, (_, n) => {
        const wallet = addr(9000 + n);
        const buy = judged({ buyer: wallet, when: at(l.launchedAt, 1), mint: l.mint });
        return { wallet, holdsNow: true, firstBuy: buy };
      });
      points += total(judgeHoldersKept({ mint: l.mint, creator: CREATOR, launchedAt: l.launchedAt, monthLaunches: launches, at: at(l.launchedAt, 60), holders }));
    }
    return points;
  };
  const three = pay(3);
  assert.equal(three, 3 * (POINTS.survival_7 + POINTS.survival_30 + POINTS.survival_90 + 5 * POINTS.holders_kept));
  assert.equal(pay(30), three);
  assert.equal(pay(100), three);
  assert.equal(pay(1), three / 3);
});

test("paid entries: no vault but the free ones pays, and a report that says it was paid pays nothing", () => {
  const day = "2026-10-27";
  for (const vault of ["ryntra-1", "ryntra-daily", "tower-" + MINT, "creator-42", "unbreakable", "practice-4", "", "DAILY"]) {
    assert.deepEqual(judgeVaultCrack({ kind: "vault_crack", vault }, day), { paid: false, why: "paid_entry" }, vault);
  }
  for (const vault of ["practice-1", "practice-2", "practice-3", "daily"]) {
    assert.deepEqual(judgeVaultCrack({ kind: "vault_crack", vault, paid: true }, day), { paid: false, why: "paid_entry" }, vault);
    assert.deepEqual(judgeStep({ kind: "vault_crack", vault, paid: true }, day), { paid: false, why: "paid_entry" }, vault);
  }
});

test("cluster trades: the creator's own wallets, co-signed trades, one cluster or not known — nothing pays", async () => {
  const when = at(LAUNCH, 6);
  // The creator buying through three other wallets the Growth line links to it.
  assert.equal(total(judgeSurvival(survivalFacts({ buyers: 20, cluster: "same" }))), 0);
  // Three buyers the Growth line has not answered about yet.
  assert.equal(total(judgeSurvival(survivalFacts({ buyers: 20, cluster: "unknown" }))), 0);
  // Three «different» buyers whose transactions the creator signed.
  const cosigned = survivalFacts({ buyers: 0 });
  for (let i = 0; i < 5; i += 1) cosigned.buys.push(judged({ buyer: addr(700 + i), when, signers: [addr(700 + i), CREATOR] }));
  assert.equal(total(judgeSurvival(cosigned)), 0);
  // Without the Growth line's check every pair is not known: the honest count's default counts nothing.
  const unchecked = survivalFacts({ buyers: 0 });
  for (let i = 0; i < 5; i += 1) {
    const trade = judged({ buyer: addr(800 + i), when }).trade;
    unchecked.buys.push({ trade, judgement: await judgeCityTrade(trade, NO_CLUSTER_CHECK) });
  }
  assert.equal(total(judgeSurvival(unchecked)), 0);
  // A judgement of another trade, or one that does not name the creator, is not this coin's buyer.
  const borrowed = survivalFacts({ buyers: 3 });
  borrowed.buys = borrowed.buys.map((b, i) => (i === 0 ? { trade: b.trade, judgement: { ...b.judgement, tx: "x" } } : b));
  assert.equal(total(judgeSurvival(borrowed)), 0);
  const otherParty = survivalFacts({ buyers: 0 });
  for (let i = 0; i < 3; i += 1) otherParty.buys.push(judged({ buyer: addr(900 + i), when, party: addr(42), slot: "host" }));
  assert.equal(total(judgeSurvival(otherParty)), 0, "checked against someone else, not against the creator");
  // A pool whose fees came only from the owner's cluster, visitors from the host's own cluster.
  assert.equal(total(judgePoolWeek(poolWeek({ cluster: "same" }))), 0);
  const pool = poolWeek();
  for (const d of pool.days) d.trades = d.trades.map((t) => judged({ buyer: OWNER, when: t.trade.at, party: OWNER, mint: t.trade.mint }));
  assert.equal(total(judgePoolWeek(pool)), 0, "the owner trading against its own position");
  const puppets = Array.from({ length: 30 }, (_, i) => visit(`puppet-${i}`, at(MONDAY, i / 10), "same"));
  assert.equal(total(judgeVisitors({ hostId: "host", week: MONDAY, visits: puppets })), 0);
});
