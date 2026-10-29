import assert from "node:assert/strict";
import test from "node:test";

import {
  COINS_PER_MONTH,
  CRACK_POINTS,
  FREE_VAULTS,
  HOLDER_STEPS,
  HOLD_DAYS,
  MIN_INDEPENDENT_BUYERS,
  MIN_POOL_USD_MICROS,
  MIN_POSITION_USD_MICROS,
  MIN_TRADE_USD_MICROS,
  NOT_PAID,
  POSITIONS_COUNTED,
  STEP_RULES,
  SURVIVAL_DAYS,
  VISITORS_PER_DAY,
  judgeCoop,
  judgeHoldersKept,
  judgePoolWeek,
  judgeStep,
  judgeSurvival,
  judgeVaultCrack,
  judgeVisitors,
  judgeWar,
} from "./points.ts";
import { CREATOR, LAUNCH, MINT, MONDAY, POSITION, addr, at, judged, poolWeek, random, survivalFacts, visit } from "./fixtures.mjs";
import { POINTS } from "../world/catalog.ts";
import { POINTS_REASONS } from "../world/contract.ts";
import { PROTECT_RULES } from "../growth/protect.ts";
import { MIN_POSITION_USD, POOL_MIN_VERIFIED_USD, STEWARD_DAYS } from "../growth/liquidity.ts";
import { VAULTS, VAULT_IDS } from "../vault/levels.ts";

/*
 * The city's points as rules: every reason of the world has one, each pays what the world's list says, each pays a
 * key once, and no rule can make more keys in its window than its cap — so no step reported twice, no job run again
 * and no answer that changes later pays past the ceiling.
 */

const keys = (result) => (result.paid === true ? [result.award.key] : result.paid === false ? [] : result.awards.map((a) => a.key));

test("every reason of the world has one rule, at the world's price; only the steps the server can check today are live", () => {
  assert.deepEqual(Object.keys(STEP_RULES).sort(), [...POINTS_REASONS].sort());
  for (const reason of POINTS_REASONS) {
    const rule = STEP_RULES[reason];
    assert.equal(rule.points, POINTS[reason], reason);
    assert.ok(rule.caps.length >= 1 && rule.caps.every((c) => Number.isInteger(c.max) && c.max >= 1), reason);
    assert.match(rule.key, new RegExp(`^${reason === "vault_crack" ? "vault" : reason}:`), reason);
  }
  assert.deepEqual(Object.keys(STEP_RULES).filter((r) => STEP_RULES[r].live).sort(), ["task_done", "vault_crack"]);
  assert.ok(Object.values(NOT_PAID).length === new Set(NOT_PAID).size);
});

test("the numbers are the Growth line's and the vault's own, read where they live", () => {
  assert.equal(MIN_INDEPENDENT_BUYERS, PROTECT_RULES.activation.independentAddresses);
  assert.equal(MIN_TRADE_USD_MICROS, PROTECT_RULES.activation.minTradeUsdMicros);
  assert.equal(MIN_POSITION_USD_MICROS, BigInt(MIN_POSITION_USD) * 1_000_000n);
  assert.equal(MIN_POOL_USD_MICROS, BigInt(POOL_MIN_VERIFIED_USD) * 1_000_000n);
  assert.equal(STEWARD_DAYS, 7, "a week in range is the Steward's seven days");
  assert.deepEqual([...FREE_VAULTS], [...VAULT_IDS]);
  for (const id of FREE_VAULTS) assert.equal(CRACK_POINTS[id], VAULTS[id].points, id);
  assert.equal(POINTS.vault_crack, CRACK_POINTS.daily);
});

test("one vault crack has one price everywhere: the world's, the rules' and the Vault's own", () => {
  assert.equal(POINTS.vault_crack, VAULTS.daily.points, "the world's book pays what the Vault shows for its daily vault");
  assert.equal(STEP_RULES.vault_crack.points, VAULTS.daily.points, "the rules say the same price");
  for (const id of FREE_VAULTS) assert.match(STEP_RULES.vault_crack.step, new RegExp(`\\b${VAULTS[id].points}\\b`), `${id}: the step names the Vault's price`);
});

/* ------------------------------------------------------------------------------------------------ survival */

test("survival: alive on its day with three buyers outside the creator's cluster pays once per coin and day", () => {
  for (const day of SURVIVAL_DAYS) {
    const verdict = judgeSurvival(survivalFacts({ day }));
    assert.deepEqual(verdict, { paid: true, award: { reason: `survival_${day}`, points: POINTS[`survival_${day}`], sourceRef: MINT, key: `survival_${day}:${MINT}` } });
  }
});

test("survival: fewer buyers, a buyer twice, the creator's own cluster, not known, outside the week or not alive pay nothing", () => {
  assert.deepEqual(judgeSurvival(survivalFacts({ buyers: 2 })), { paid: false, why: "too_few_buyers" });
  const twice = survivalFacts({ buyers: 2 });
  twice.buys.push(judged({ buyer: twice.buys[0].trade.buyer, when: twice.buys[0].trade.at }));
  assert.deepEqual(judgeSurvival(twice), { paid: false, why: "too_few_buyers" }, "one wallet buying twice is one buyer");
  assert.deepEqual(judgeSurvival(survivalFacts({ buyers: 5, cluster: "same" })), { paid: false, why: "cluster" });
  assert.deepEqual(judgeSurvival(survivalFacts({ buyers: 5, cluster: "unknown" })), { paid: false, why: "unverified" });
  assert.deepEqual(judgeSurvival(survivalFacts({ dollars: 0.5 })), { paid: false, why: "too_few_buyers" }, "dust is not a buy");
  assert.deepEqual(judgeSurvival(survivalFacts({ alive: false })), { paid: false, why: "not_alive" });
  const early = survivalFacts({ day: 30 });
  for (const b of early.buys) b.trade = { ...b.trade, at: at(LAUNCH, 10) };
  assert.equal(judgeSurvival(early).paid, false, "buys three weeks before day 30 do not keep it alive on day 30");
  const self = survivalFacts({ buyers: 3 });
  self.buys.push(judged({ buyer: CREATOR, when: self.buys[0].trade.at }));
  self.buys.splice(0, 1);
  assert.deepEqual(judgeSurvival(self), { paid: false, why: "cluster" }, "the creator buying from its own wallet is not a buyer");
});

test("survival: only the first three coins a creator launched in a month can pay, whatever is launched after", () => {
  const launches = Array.from({ length: 6 }, (_, i) => ({ mint: addr(300 + i), launchedAt: at(LAUNCH, i) }));
  const paid = launches.map((l) => judgeSurvival(survivalFacts({ mint: l.mint, launchedAt: l.launchedAt, monthLaunches: launches })));
  assert.deepEqual(paid.map((v) => v.paid), [true, true, true, false, false, false]);
  assert.deepEqual(paid.slice(COINS_PER_MONTH).map((v) => v.why), ["over_cap", "over_cap", "over_cap"]);
  const nextMonth = { mint: addr(400), launchedAt: "2026-11-02T10:00:00.000Z" };
  assert.equal(judgeSurvival(survivalFacts({ mint: nextMonth.mint, launchedAt: nextMonth.launchedAt, monthLaunches: [...launches, nextMonth] })).paid, true, "a new month opens three new places");
  assert.deepEqual(judgeSurvival(survivalFacts({ monthLaunches: [] })), { paid: false, why: "malformed" }, "the coin itself must be among the month's launches");
});

/* ------------------------------------------------------------------------------------------------ holders */

function holdersFacts({ kept = 10, young = 0, sold = 0, cluster = "separate" } = {}) {
  const readAt = at(LAUNCH, 45);
  const holder = (n, days, holdsNow, c = cluster) => {
    const wallet = addr(1000 + n);
    return { wallet, holdsNow, firstBuy: judged({ buyer: wallet, when: at(readAt, -days), cluster: c }) };
  };
  return {
    mint: MINT,
    creator: CREATOR,
    launchedAt: LAUNCH,
    monthLaunches: [{ mint: MINT, launchedAt: LAUNCH }],
    at: readAt,
    holders: [
      ...Array.from({ length: kept }, (_, i) => holder(i, HOLD_DAYS + 1, true)),
      ...Array.from({ length: young }, (_, i) => holder(500 + i, HOLD_DAYS - 1, true)),
      ...Array.from({ length: sold }, (_, i) => holder(800 + i, HOLD_DAYS + 5, false)),
    ],
  };
}

test("holders who stay: each step pays once per coin; young, sold and inside holders are not kept", () => {
  assert.deepEqual(keys(judgeHoldersKept(holdersFacts({ kept: 9, young: 40, sold: 40 }))), []);
  assert.deepEqual(keys(judgeHoldersKept(holdersFacts({ kept: 26 }))), [`holders_kept:${MINT}:10`, `holders_kept:${MINT}:25`]);
  assert.deepEqual(keys(judgeHoldersKept(holdersFacts({ kept: 300 }))), HOLDER_STEPS.map((s) => `holders_kept:${MINT}:${s}`));
  assert.equal(judgeHoldersKept(holdersFacts({ kept: 300 })).why, null);
  const inside = judgeHoldersKept(holdersFacts({ kept: 300, cluster: "same" }));
  assert.deepEqual(inside, { awards: [], why: "cluster" });
  for (const a of judgeHoldersKept(holdersFacts({ kept: 30 })).awards) assert.equal(a.points, POINTS.holders_kept);
});

/* ------------------------------------------------------------------------------------------------ pools */

test("a pool week pays once per position when all seven days are in range, real and earning from outside trades", () => {
  assert.deepEqual(judgePoolWeek(poolWeek()), { paid: true, award: { reason: "lp_in_range_days", points: POINTS.lp_in_range_days, sourceRef: POSITION, key: `lp_in_range_days:${POSITION}:2026-10-19` } });
  assert.deepEqual(judgePoolWeek(poolWeek({ inRange: false })), { paid: false, why: "out_of_range" });
  assert.deepEqual(judgePoolWeek(poolWeek({ value: 9.99 })), { paid: false, why: "too_small" }, "ten dollars at least");
  assert.deepEqual(judgePoolWeek(poolWeek({ pool: 9_999 })), { paid: false, why: "too_small" }, "a live pool");
  assert.deepEqual(judgePoolWeek(poolWeek({ fees: 0 })), { paid: false, why: "no_fees" });
  assert.deepEqual(judgePoolWeek(poolWeek({ cluster: "same" })), { paid: false, why: "cluster" }, "fees from your own cluster's trades are not earned");
  assert.deepEqual(judgePoolWeek(poolWeek({ cluster: "unknown" })), { paid: false, why: "unverified" });
  assert.deepEqual(judgePoolWeek(poolWeek({ openedAt: "2026-10-21T00:00:00.000Z" })), { paid: false, why: "not_yet" }, "a week is whole");
  const short = poolWeek();
  short.days.pop();
  assert.deepEqual(judgePoolWeek(short), { paid: false, why: "not_yet" });
  assert.deepEqual(judgePoolWeek(poolWeek({ week: "2026-10-20T00:00:00.000Z" })), { paid: false, why: "malformed" }, "a week starts on Monday");
});

test("a pool week: only the owner's first three positions can pay, so splitting money pays what three positions do", () => {
  const positions = Array.from({ length: 8 }, (_, i) => ({ position: addr(600 + i), openedAt: at("2026-09-01T00:00:00.000Z", i) }));
  const verdicts = positions.map((p) => judgePoolWeek(poolWeek({ position: p.position, openedAt: p.openedAt, ownerPositions: positions })));
  assert.equal(verdicts.filter((v) => v.paid).length, POSITIONS_COUNTED);
  assert.ok(verdicts.slice(POSITIONS_COUNTED).every((v) => v.why === "over_cap"));
});

/* ------------------------------------------------------------------------------------------------ visitors */

const HOST = "host-resident";

test("visitors: signed-in visitors outside the host's cluster pay, ten a day, each once a week", () => {
  const visits = Array.from({ length: 14 }, (_, i) => visit(`visitor-${i}`, `2026-10-19T${String(8 + i).padStart(2, "0")}:00:00.000Z`));
  const monday = judgeVisitors({ hostId: HOST, week: MONDAY, visits });
  assert.equal(monday.awards.length, VISITORS_PER_DAY);
  assert.deepEqual(monday.awards.map((a) => a.key), visits.slice(0, 10).map((v) => `visitors_verified:2026-10-19:${v.visitorId}`));
  assert.deepEqual(monday.awards.map((a) => a.sourceRef), visits.slice(0, 10).map((v) => v.visitorId), "the earliest first");
  const again = [...visits, ...visits.slice(0, 5).map((v) => visit(v.visitorId, v.at.replace("2026-10-19", "2026-10-20")))];
  const week = judgeVisitors({ hostId: HOST, week: MONDAY, visits: again });
  assert.equal(week.awards.length, VISITORS_PER_DAY, "Monday's visitors coming back on Tuesday pay nothing more");
});

test("visitors: judged again after an answer changed, a visitor already paid is not paid again under a new place", () => {
  // Monday: the puppet comes first but is the host's own cluster, so «friend» takes the first place and is paid.
  const before = [visit("puppet", "2026-10-19T08:00:00.000Z", "same"), visit("friend", "2026-10-19T09:00:00.000Z")];
  const first = judgeVisitors({ hostId: HOST, week: MONDAY, visits: before });
  // Later the Growth line's answer about the first visitor changes: it now takes the first place, «friend» moves down.
  const after = [visit("puppet", "2026-10-19T08:00:00.000Z"), visit("friend", "2026-10-19T09:00:00.000Z")];
  const second = judgeVisitors({ hostId: HOST, week: MONDAY, visits: after });
  const friend = new Set([...first.awards, ...second.awards].filter((a) => a.sourceRef === "friend").map((a) => a.key));
  assert.deepEqual([...friend], ["visitors_verified:2026-10-19:friend"], "one key for the visitor and the week, whatever its place");
  // Coming back on Thursday, after both readings, still the same key.
  const thursday = judgeVisitors({ hostId: HOST, week: MONDAY, visits: [visit("friend", "2026-10-22T10:00:00.000Z")] });
  assert.deepEqual(thursday.awards.map((a) => a.key), ["visitors_verified:2026-10-19:friend"]);
  const nextWeek = judgeVisitors({ hostId: HOST, week: "2026-10-26T00:00:00.000Z", visits: [visit("friend", "2026-10-26T10:00:00.000Z")] });
  assert.deepEqual(nextWeek.awards.map((a) => a.key), ["visitors_verified:2026-10-26:friend"], "a new week pays again");
});

test("visitors: guests, the host, the host's own cluster and visitors not known pay nothing", () => {
  const when = "2026-10-21T10:00:00.000Z";
  assert.deepEqual(judgeVisitors({ hostId: HOST, week: MONDAY, visits: [visit("guest", when, "separate", false)] }), { awards: [], why: "no_visitors" });
  assert.deepEqual(judgeVisitors({ hostId: HOST, week: MONDAY, visits: [visit(HOST, when)] }), { awards: [], why: "no_visitors" });
  assert.deepEqual(judgeVisitors({ hostId: HOST, week: MONDAY, visits: [visit("puppet", when, "same")] }), { awards: [], why: "cluster" });
  assert.deepEqual(judgeVisitors({ hostId: HOST, week: MONDAY, visits: [visit("someone", when, "unknown")] }), { awards: [], why: "unverified" });
  const outside = judgeVisitors({ hostId: HOST, week: MONDAY, visits: [visit("someone", at(MONDAY, 9))] });
  assert.deepEqual(outside, { awards: [], why: "no_visitors" }, "a visit of another week is not this week's");
});

/* ------------------------------------------------------------------------------------------------ together, war */

test("building together pays once a day when someone in the crew is another person; the war pays a week of actions", () => {
  const sep = { residentId: "b", cluster: { verdict: "separate", rules: "test" } };
  const same = { residentId: "c", cluster: { verdict: "same", reason: "linked_wallet", rules: "test" } };
  const unknown = { residentId: "d", cluster: { verdict: "unknown", why: "test" } };
  assert.deepEqual(judgeCoop({ day: "2026-10-27", built: true, others: [same, sep] }), { paid: true, award: { reason: "coop_contribution", points: 10, sourceRef: "2026-10-27", key: "coop_contribution:2026-10-27" } });
  assert.deepEqual(judgeCoop({ day: "2026-10-27", built: true, others: [same] }), { paid: false, why: "cluster" });
  assert.deepEqual(judgeCoop({ day: "2026-10-27", built: true, others: [unknown] }), { paid: false, why: "unverified" });
  assert.deepEqual(judgeCoop({ day: "2026-10-27", built: true, others: [] }), { paid: false, why: "alone" });
  assert.deepEqual(judgeCoop({ day: "2026-10-27", built: false, others: [sep] }), { paid: false, why: "not_yet" });
  assert.deepEqual(judgeWar({ week: MONDAY, actions: 4 }), { paid: true, award: { reason: "war_participation", points: 20, sourceRef: "2026-10-19", key: "war_participation:2026-10-19" } });
  assert.deepEqual(judgeWar({ week: MONDAY, actions: 0 }), { paid: false, why: "not_yet" });
});

/* ------------------------------------------------------------------------------------------------ vaults */

test("a free vault pays by the vault: practice once ever, the daily vault once on the world's day", () => {
  const day = "2026-10-27";
  for (const id of FREE_VAULTS) {
    const verdict = judgeVaultCrack({ kind: "vault_crack", vault: id }, day);
    assert.equal(verdict.paid, true, id);
    assert.equal(verdict.award.points, CRACK_POINTS[id]);
    assert.equal(verdict.award.key, id === "daily" ? `vault:daily:${day}` : `vault:${id}:once`);
  }
  const report = { kind: "vault_crack", vault: "practice-1", day: "2030-01-01", points: 9999, idempotencyKey: "vault:x", title: "breaker", at: "x" };
  assert.deepEqual(judgeStep(report, day), { paid: true, award: { reason: "vault_crack", points: 10, sourceRef: "practice-1", key: "vault:practice-1:once" } }, "the report's points, key and day are not read");
  assert.deepEqual(judgeStep({ kind: "vault_crack", vault: "daily", day: "2030-01-01" }, day).award.key, `vault:daily:${day}`);
  assert.deepEqual(judgeStep({ kind: "survival_90" }, day), { paid: false, why: "not_a_step" }, "a request reports only what happened in it");
  assert.deepEqual(judgeStep(null, day), { paid: false, why: "not_a_step" });
  assert.deepEqual(judgeVaultCrack({ kind: "vault_crack", vault: 7 }, day), { paid: false, why: "malformed" });
});

/* ------------------------------------------------------------------------------------------------ ceilings */

test("ceilings: however facts are reported, again and changed, no rule makes more keys in a window than its cap", () => {
  const rnd = random(19);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const clusters = ["separate", "separate", "separate", "same", "unknown"];
  const seen = { survival: new Map(), holders: new Set(), lp: new Map(), visitors: new Map(), coop: new Map(), vault: new Map() };

  for (let run = 0; run < 400; run += 1) {
    // One creator launching up to 12 coins a month; reported again and again with other buyers and answers.
    const launches = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ mint: addr(2000 + i), launchedAt: at(LAUNCH, i * 2) }));
    const coin = pick(launches);
    const day = pick([7, 30, 90]);
    const facts = survivalFacts({ day, mint: coin.mint, launchedAt: coin.launchedAt, monthLaunches: launches, buyers: Math.floor(rnd() * 8), cluster: pick(clusters), dollars: pick([0.5, 1, 25, 25_000]) });
    for (const k of keys(judgeSurvival(facts))) seen.survival.set(k, day);

    const h = holdersFacts({ kept: Math.floor(rnd() * 400), cluster: pick(clusters) });
    h.mint = coin.mint;
    h.launchedAt = coin.launchedAt;
    h.monthLaunches = launches;
    for (const holder of h.holders) holder.firstBuy = { ...holder.firstBuy, trade: { ...holder.firstBuy.trade, mint: coin.mint } };
    for (const k of keys(judgeHoldersKept(h))) seen.holders.add(k);

    // One owner with up to 10 positions, weeks reported in any order.
    const positions = Array.from({ length: 1 + Math.floor(rnd() * 10) }, (_, i) => ({ position: addr(3000 + i), openedAt: at("2026-09-01T00:00:00.000Z", i) }));
    const p = pick(positions);
    const week = pick(["2026-10-12T00:00:00.000Z", MONDAY, "2026-10-26T00:00:00.000Z"]);
    for (const k of keys(judgePoolWeek(poolWeek({ week, position: p.position, openedAt: p.openedAt, ownerPositions: positions, cluster: pick(clusters) })))) seen.lp.set(k, week);

    // One host's week with up to 60 visits a day, answers that change between runs.
    const visits = Array.from({ length: Math.floor(rnd() * 60) }, () => visit(`v-${Math.floor(rnd() * 40)}`, new Date(Date.parse(MONDAY) + Math.floor(rnd() * 7 * 86_400_000)).toISOString(), pick(clusters), rnd() > 0.1));
    // Within one reading a day pays at most its ten places; across readings one visitor holds one key a week.
    const judged = judgeVisitors({ hostId: HOST, week: MONDAY, visits });
    assert.ok(judged.awards.length <= VISITORS_PER_DAY * 7 && new Set(judged.awards.map((a) => a.sourceRef)).size === judged.awards.length, "visitors of one reading");
    for (const a of judged.awards) seen.visitors.set(a.key, a.sourceRef);

    const coopDay = pick(["2026-10-26", "2026-10-27"]);
    for (const k of keys(judgeCoop({ day: coopDay, built: true, others: [{ residentId: "x", cluster: { verdict: pick(clusters), rules: "t", reason: "linked_wallet", why: "t" } }] }))) seen.coop.set(k, coopDay);

    const vaultDay = pick(["2026-10-26", "2026-10-27"]);
    for (const k of keys(judgeVaultCrack({ kind: "vault_crack", vault: pick([...FREE_VAULTS, "ryntra-1", "creator-7"]), paid: rnd() > 0.8 }, vaultDay))) seen.vault.set(k, vaultDay);
  }

  const count = (map) => {
    const by = new Map();
    for (const w of map.values()) by.set(w, (by.get(w) ?? 0) + 1);
    return Math.max(0, ...by.values());
  };
  // Survival: per milestone, the coins of one launch month are at most three.
  for (const day of SURVIVAL_DAYS) {
    const coins = [...seen.survival].filter(([, d]) => d === day).length;
    assert.ok(coins <= STEP_RULES[`survival_${day}`].caps[0].max, `survival_${day}: ${coins}`);
  }
  assert.ok(seen.holders.size <= STEP_RULES.holders_kept.caps[0].max, `holders: ${seen.holders.size}`);
  assert.ok(count(seen.lp) <= STEP_RULES.lp_in_range_days.caps[0].max, "pool weeks");
  assert.equal(new Set(seen.visitors.values()).size, seen.visitors.size, "one key per visitor and week, however the answers changed");
  assert.ok(count(seen.coop) <= STEP_RULES.coop_contribution.caps[0].max, "building together a day");
  const practice = [...seen.vault.keys()].filter((k) => k.endsWith(":once")).length;
  const daily = new Map([...seen.vault].filter(([k]) => k.startsWith("vault:daily:")));
  assert.ok(practice <= STEP_RULES.vault_crack.caps[0].max && count(daily) <= STEP_RULES.vault_crack.caps[1].max, "vaults");
  // The caps were reached, so the test proves the ceiling, not an empty run.
  assert.equal(seen.lp.size > 0 && seen.visitors.size > 0 && seen.survival.size > 0 && seen.holders.size > 0, true);
});
