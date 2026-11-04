import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { PROTECT_RULES } from "../growth/protect.ts";
import { REFERRAL_GUARD_RULES } from "../growth/referral-guard.ts";
import { PAYOUTS_FIRST_WEEK, SHARED_PRODUCTS } from "../partner-payouts/week.ts";
import { NETWORK_RULES_V1 } from "./network-rules.ts";
import { PARTNER_TERMS, termsRows } from "../../city/lib/partners/terms.ts";
import { PARTNER_TERM_KEYS, paidAsStatus, partnerFactsOf, programmeGaps, programmeOf } from "./partner-facts.ts";
import { REWARD_CLAIM_ASSET } from "./treasury.server.ts";
import { readPartnerFacts } from "./partner-facts.server.ts";
import { rewardRulesEffectiveFrom, rewardRulesV21EffectiveFrom, rewardRulesV22EffectiveFrom } from "./rank-store.ts";
import {
  RANK_THRESHOLDS_V1,
  RANK_WINDOW_DAYS,
  REWARD_RANKS,
  REWARD_RULES_V1,
  REWARD_RULES_V2,
  REWARD_RULES_V2_1_NOT_BEFORE,
  REWARD_RULES_V2_2,
  REWARD_RULES_V2_2_NOT_BEFORE,
} from "./rules.ts";

/*
 * Ryntra Partners R2 — the programme's facts, read only: the programme from decision 93 (`city/lib/partners/terms.ts`),
 * the engine from the rules modules, the gaps between them computed; no figure typed by hand.
 */

const NOW = "2026-10-29T12:00:00.000Z";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T00:00:00Z" };
const PAYOUTS_ON = { RYNTRA_PARTNER_PAYOUTS: "on", RYNTRA_PARTNER_PAYOUTS_MULTISIG: "4qFxfhdHoJvRtSyfmx8ZnCH8k8Cvb6WicPDaYYnsECLM" };

const facts = (over = {}) => partnerFactsOf({ now: NOW, rules: REWARD_RULES_V2_2, rulesSince: "2026-10-27T10:00:00.000Z", network: NETWORK_RULES_V1, partnerPayoutsOn: false, discountOn: false, activation: null, claimAsset: REWARD_CLAIM_ASSET, ...over });

test("the programme is decision 93, read from `city/lib/partners/terms.ts` — the same object the partner page and the city print", () => {
  const { programme } = facts();
  assert.equal(PARTNER_TERMS.decided, "93");
  assert.deepEqual(programme, {
    decided: PARTNER_TERMS.decided,
    first: { bps: PARTNER_TERMS.share.firstBps, percent: PARTNER_TERMS.share.firstBps / 100, days: PARTNER_TERMS.share.firstDays },
    after: { bps: PARTNER_TERMS.share.afterBps, percent: PARTNER_TERMS.share.afterBps / 100 },
    attribution: PARTNER_TERMS.attribution,
    refereeDiscount: { bps: PARTNER_TERMS.refereeDiscountBps, percent: PARTNER_TERMS.refereeDiscountBps / 100 },
    minimumPayoutUsd: PARTNER_TERMS.minimumPayoutUsd,
    payoutAsset: PARTNER_TERMS.payoutAsset,
    cadence: PARTNER_TERMS.cadence,
    levels: PARTNER_TERMS.levels,
  });
  /* Decision 93 in its own words (DECISIONS 31.10, night): 40 % for each person's first 90 days, then 30 %, for good;
     10 % off for the person brought; from $5, USDC, weekly; one level. */
  assert.deepEqual(
    [programme.first.percent, programme.first.days, programme.after.percent, programme.attribution, programme.refereeDiscount.percent, programme.minimumPayoutUsd, programme.payoutAsset, programme.cadence, programme.levels],
    [40, 90, 30, "lifetime", 10, 5, "USDC", "weekly", 1],
  );
  /* The partner page prints the same numbers from the same place. */
  const rows = termsRows("en").rows.map((row) => row.value);
  assert.ok(rows[0].includes(`${programme.first.percent}%`) && rows[0].includes(`${programme.after.percent}%`) && rows[0].includes(String(programme.first.days)));
});

test("terms still open: no programme, nothing reconciled, nothing invented", () => {
  const open = facts({ terms: { ...PARTNER_TERMS, share: null } });
  assert.equal(open.programme, null);
  assert.deepEqual(open.reconciliation, { matches: false, gaps: [] });
  assert.equal(facts({ terms: { ...PARTNER_TERMS, decided: null } }).programme, null);
});

test("the reconciliation: under rules 2.2.0 the engine does not count decision 93 yet — every gap named, term by term", () => {
  const { reconciliation, engine } = facts();
  assert.equal(reconciliation.matches, false);
  const byTerm = Object.fromEntries(reconciliation.gaps.map((gap) => [gap.term, [gap.programme, gap.engine]]));
  assert.deepEqual(byTerm, {
    firstShare: ["40% × 90 days", "30% × 90 days"],
    afterShare: ["30%", "10%–30% by rank"],
    refereeDiscount: ["10%", "none"],
    levels: ["1", "2"],
    minimumPayout: ["$5.00", "$1.00"],
    cadence: ["weekly", "on claim"],
  });
  assert.ok(reconciliation.gaps.every((gap) => PARTNER_TERM_KEYS.includes(gap.term)));
  /* Attribution agrees: the engine binds a friend for good, as decision 93 says; and a claim pays USDC, as the programme. */
  assert.ok(!("attribution" in byTerm));
  assert.ok(!("payoutAsset" in byTerm));
  assert.equal(engine.claimAsset, REWARD_CLAIM_ASSET);
});

test("a rules version that carried decision 93 would reconcile: no gap on the shares and the levels", () => {
  const rules = {
    ...REWARD_RULES_V2_2,
    referralL1BpsByRank: Object.fromEntries(REWARD_RANKS.map((rank) => [rank, PARTNER_TERMS.share.afterBps])),
    referralL2Bps: 0,
    inviterWindow: { bps: PARTNER_TERMS.share.firstBps, days: PARTNER_TERMS.share.firstDays },
  };
  const terms = ["firstShare", "afterShare", "levels"];
  assert.deepEqual(programmeGaps(programmeOf(), rules, { floorUsdMicros: 5_000_000n, asset: "USDC" }).map((gap) => gap.term).filter((term) => terms.includes(term)), []);
});

test("the engine today, rules 2.2.0: every share, the ladder, the 90 days, «First $10 back», the second level and the ceiling — from the rules", () => {
  const read = facts().engine;
  assert.equal(read.versions.traders, "2.2.0");
  assert.equal(read.versions.network, NETWORK_RULES_V1.version);
  assert.equal(facts().guard.protect, PROTECT_RULES.version);
  assert.equal(facts().guard.version, REFERRAL_GUARD_RULES.version);
  assert.deepEqual(read.cashback, { bps: REWARD_RULES_V2_2.cashbackBps, percent: 50 });
  assert.deepEqual(read.inviter.ranks.map((rank) => [rank.rank, rank.fromPoints, rank.percent]), [
    ["BRONZE", 0, 10], ["SILVER", 10, 15], ["GOLD", 100, 20], ["SAPPHIRE", 1000, 25], ["DIAMOND", 10000, 30],
  ]);
  for (const rank of read.inviter.ranks) {
    assert.equal(rank.bps, REWARD_RULES_V2_2.referralL1BpsByRank[rank.rank]);
    assert.equal(BigInt(rank.fromPoints), REWARD_RULES_V2_2.rankThresholds[rank.rank]);
  }
  assert.equal(read.inviter.rankWindowDays, RANK_WINDOW_DAYS);
  assert.deepEqual(read.inviter.friendWindow, { bps: 3000, percent: 30, days: 90 });
  assert.deepEqual(read.secondLevel, { bps: 500, percent: 5 });
  assert.deepEqual(read.ceiling, { bps: 8500, percent: 85 });
  assert.deepEqual(read.firstTen, { bps: 10_000, percent: 100, capUsdMicros: "10000000", days: 30, walletsPerMonth: 100 });
  assert.deepEqual(read.claimFloor, { withAccountUsdMicros: "250000", withoutAccountUsdMicros: "1000000" });
  assert.deepEqual(read.network.schedules.STANDARD, [{ untilDay: 180, bps: 2000, percent: 20 }, { untilDay: null, bps: 1000, percent: 10 }]);
  assert.deepEqual(read.network.schedules.FOUNDING.map((step) => step.percent), [30, 15, 10]);
  assert.deepEqual([read.network.foundingSeats, read.network.poolCap.percent, read.network.holdDays], [20, 40, 14]);
  assert.equal(read.tradersRulesSince, "2026-10-27T10:00:00.000Z");
});

test("older rules read as they were: 2.0.0 has no window, no «First $10 back», all of the fee as ceiling; 1.0.0 the old ladder", () => {
  const two = facts({ rules: REWARD_RULES_V2 }).engine;
  assert.equal(two.inviter.friendWindow, null);
  assert.equal(two.firstTen, null);
  assert.equal(two.ceiling.percent, 100);
  const one = facts({ rules: REWARD_RULES_V1, rulesSince: null }).engine;
  assert.equal(one.inviter.base, "GROSS");
  assert.deepEqual(one.inviter.ranks.map((rank) => BigInt(rank.fromPoints)), REWARD_RANKS.map((rank) => RANK_THRESHOLDS_V1[rank]));
  assert.ok(one.inviter.ranks.every((rank) => rank.percent === 10));
});

test("paid as: OPEN only while the weekly partner payouts run (CITY-128); anything else COUNTED", () => {
  assert.equal(paidAsStatus(true), "OPEN");
  assert.equal(paidAsStatus(false), "COUNTED");
});

test("products: swap and launch wait while the payouts are off and are live once they run; the rest have no share", () => {
  const today = facts();
  assert.deepEqual(today.products, { swap: "pending", launch: "pending", perps: "none", predictions: "none", pools: "none", agents: "none" });
  assert.deepEqual(today.payouts, { paidAs: "COUNTED", firstWeek: PAYOUTS_FIRST_WEEK, products: [...SHARED_PRODUCTS], discountOn: false });
  assert.deepEqual(today.rewards, { countingFrom: null, started: false });
  const live = facts({ partnerPayoutsOn: true, discountOn: true, activation: "2026-09-10T00:00:00.000Z" });
  assert.deepEqual([live.products.swap, live.products.launch, live.payouts.paidAs, live.payouts.discountOn, live.rewards.started, live.rewards.countingFrom], ["live", "live", "OPEN", true, true, "2026-09-10T00:00:00.000Z"]);
  /* An activation still ahead counts from then, and has not started. */
  assert.equal(facts({ activation: "2027-01-01T00:00:00.000Z" }).rewards.started, false);
});

test("readPartnerFacts reads the store and starts nothing; the switch needs its treasury; a store that does not answer is null", async () => {
  const store = createMemoryGuardStore();
  const before = await readPartnerFacts(store, NOW, ENV);
  assert.equal(before.engine.versions.traders, "1.0.0");
  assert.equal(await store.collection("rewardRules").get("2.0.0") ?? null, null, "a read writes no moment");
  await rewardRulesEffectiveFrom(store, "2026-10-01T00:00:00.000Z", ENV);
  await rewardRulesV21EffectiveFrom(store, REWARD_RULES_V2_1_NOT_BEFORE, ENV);
  await rewardRulesV22EffectiveFrom(store, REWARD_RULES_V2_2_NOT_BEFORE, ENV);
  const after = await readPartnerFacts(store, NOW, ENV);
  assert.equal(after.engine.versions.traders, "2.2.0");
  assert.equal(after.engine.tradersRulesSince, REWARD_RULES_V2_2_NOT_BEFORE);
  assert.equal(after.rewards.countingFrom, "2026-09-10T00:00:00.000Z");
  assert.deepEqual([after.payouts.paidAs, after.products.swap, after.products.launch], ["COUNTED", "pending", "pending"]);
  const on = await readPartnerFacts(store, NOW, { ...ENV, ...PAYOUTS_ON, NEXT_PUBLIC_RYNTRA_REFEREE_DISCOUNT: "on" });
  assert.deepEqual([on.payouts.paidAs, on.payouts.discountOn, on.products.swap], ["OPEN", true, "live"]);
  /* The switch without the treasury that pays pays nobody. */
  assert.equal((await readPartnerFacts(store, NOW, { ...ENV, RYNTRA_PARTNER_PAYOUTS: "on" })).payouts.paidAs, "COUNTED");
  const broken = { ...createMemoryGuardStore(), collection: () => { throw new Error("down"); }, versioned: () => { throw new Error("down"); } };
  assert.equal(await readPartnerFacts(broken, NOW, ENV), null);
});

test("no hand-typed figure: the facts modules hold no share, threshold or day count of their own", () => {
  for (const file of ["./partner-facts.ts", "./partner-facts.server.ts", "../../app/api/rewards/partner-facts/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const figure of ["4000", "5000", "3000", "8500", "2000", "1500", "10000", "1_000", "10_000n", "180", "90,", "365"]) assert.ok(!source.includes(figure), `${file}: ${figure}`);
  }
});
