import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { partnerPayouts, readGuestProgramme } from "../growth/guest-programme.server.ts";
import { PARTNER_PAYOUT_COLLECTION, payoutGateKey, setPayoutPause } from "../growth/partner-payout.ts";
import { NETWORK_RULES_V1 } from "./network-rules.ts";
import { programmeFacts } from "./programme-facts.ts";
import { rewardRulesEffectiveFrom, rewardRulesV21EffectiveFrom } from "./rank-store.ts";
import { REWARD_RULES_V1, REWARD_RULES_V2, REWARD_RULES_V2_1, REWARD_RULES_V2_1_NOT_BEFORE } from "./rules.ts";

/*
 * Ріст 19: what a guest reads on Rewards comes from the rules in force — never a figure written on the page — and
 * says beside each share whether it is paid in USDC, counted until payouts open, or status only.
 */

const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T00:00:00Z" };
const GATE = {
  schema: 1,
  network: "solana",
  claimId: "canary-1",
  wallet: "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp",
  usdMicros: "1000000",
  signature: "5".repeat(88),
  paidAt: "2026-10-20T00:00:00.000Z",
  version: 0,
};

test("rules 2.1.0: cashback, the rank range, the 90-day window, the second level, «First $10 back»", () => {
  const facts = programmeFacts({ rules: REWARD_RULES_V2_1, network: NETWORK_RULES_V1, payouts: "CLOSED", started: true });
  assert.deepEqual(facts, {
    started: true,
    cashbackPercent: 50,
    friends: { from: 10, to: 30 },
    friendWindow: { percent: 30, days: 90 },
    theirFriendsPercent: 5,
    firstTen: { percent: 100, capUsd: 10, days: 30, walletsPerMonth: 100 },
    partnerPercent: 20,
    partnerThen: { afterDays: 180, percent: 10 },
    partnerPaidAs: "COUNTED",
  });
});

test("rules 2.0.0 have no window and no «First $10 back»; 1.0.0 one share for every rank", () => {
  const two = programmeFacts({ rules: REWARD_RULES_V2, network: NETWORK_RULES_V1, payouts: "CLOSED", started: true });
  assert.equal(two.friendWindow, null);
  assert.equal(two.firstTen, null);
  assert.deepEqual(two.friends, { from: 10, to: 30 });
  const one = programmeFacts({ rules: REWARD_RULES_V1, network: NETWORK_RULES_V1, payouts: "CLOSED", started: false });
  assert.deepEqual(one.friends, { from: 10, to: 10 });
  assert.equal(one.started, false);
});

test("partner money reads as paid only once the gate is written and not paused", () => {
  for (const [payouts, paidAs] of [["OPEN", "USDC"], ["PAUSED", "PAUSED"], ["CLOSED", "COUNTED"]]) {
    assert.equal(programmeFacts({ rules: REWARD_RULES_V2_1, network: NETWORK_RULES_V1, payouts, started: true }).partnerPaidAs, paidAs);
  }
});

test("partnerPayouts: closed without the canary's gate, open with it, paused by the owner", async () => {
  const store = createMemoryGuardStore();
  assert.equal(await partnerPayouts(store), "CLOSED");
  /* A pause alone does not open anything. */
  await setPayoutPause(store, { network: "solana", paused: true, note: "test", by: "owner", at: "2026-10-20T00:00:00.000Z" });
  assert.equal(await partnerPayouts(store), "CLOSED");
  assert.equal(await store.versioned(PARTNER_PAYOUT_COLLECTION).compareAndSet(payoutGateKey("solana"), null, GATE), true);
  assert.equal(await partnerPayouts(store), "PAUSED");
  await setPayoutPause(store, { network: "solana", paused: false, note: "test", by: "owner", at: "2026-10-20T01:00:00.000Z" });
  assert.equal(await partnerPayouts(store), "OPEN");
});

test("partnerPayouts: a damaged gate is closed", async () => {
  const store = createMemoryGuardStore();
  await store.versioned(PARTNER_PAYOUT_COLLECTION).compareAndSet(payoutGateKey("solana"), null, { ...GATE, usdMicros: "x" });
  assert.equal(await partnerPayouts(store), "CLOSED");
});

test("readGuestProgramme reads the rules in force and starts nothing", async () => {
  const store = createMemoryGuardStore();
  const now = "2026-10-21T12:00:00.000Z";
  /* Nothing stored: the earliest rules, and the read writes no moment of its own. */
  const before = await readGuestProgramme(store, now, ENV);
  assert.deepEqual(before?.friends, { from: 10, to: 10 });
  assert.equal(await store.collection("rewardRules").get("2.0.0") ?? null, null);
  await rewardRulesEffectiveFrom(store, "2026-10-01T00:00:00.000Z", ENV);
  await rewardRulesV21EffectiveFrom(store, REWARD_RULES_V2_1_NOT_BEFORE, ENV);
  const after = await readGuestProgramme(store, now, ENV);
  assert.deepEqual(after?.friendWindow, { percent: 30, days: 90 });
  assert.deepEqual(after?.firstTen, { percent: 100, capUsd: 10, days: 30, walletsPerMonth: 100 });
  assert.equal(after?.started, true);
  assert.equal((await readGuestProgramme(store, now, {}))?.started, false);
  /* An activation instant still ahead is not a start. */
  assert.equal((await readGuestProgramme(store, now, { RYNTRA_REWARDS_ACTIVATION_AT: "2027-01-01T00:00:00Z" }))?.started, false);
});

test("readGuestProgramme: a store that does not answer is null, never a guess", async () => {
  const broken = { ...createMemoryGuardStore(), collection: () => { throw new Error("down"); }, versioned: () => { throw new Error("down"); } };
  assert.equal(await readGuestProgramme(broken, "2026-10-21T12:00:00.000Z", ENV), null);
});
