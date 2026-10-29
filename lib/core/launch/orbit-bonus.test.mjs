// MC-3: Orbit Bonus — 20 % of what Ryntra already received from the mission, inside one ceiling of 70 % for every payout
// of a launch, paid at the checks of days 7, 30 and 90 by SOL-L3's definition with the crew excluded.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LAUNCH_PAYOUT_CEILING_BPS,
  LAUNCH_PAYOUT_RATES_BPS,
  ORBIT_BONUS_BPS,
  ORBIT_BONUS_LIVE,
  bonusCheck,
  bonusCutAt,
  bonusExcluded,
  checkedCrew,
  orbitBonusCourse,
  orbitBonusEntitlementRaw,
  orbitBonusTranche,
  payoutRoomRaw,
} from "./orbit-bonus.ts";

const DAY = 86_400;
const LAUNCH = 1_760_000_000;
const CREATOR = "Creator1111111111111111111111111111111111";
const MATE = "Mate11111111111111111111111111111111111111";
const RYNTRA = "Ryntra11111111111111111111111111111111111";
const BUYER = "Buyer111111111111111111111111111111111111";
/** USDC, six decimals. */
const usd = (dollars) => BigInt(Math.round(dollars * 1_000_000));
const CREW = [
  { wallet: CREATOR, bps: 8_000 },
  { wallet: MATE, bps: 2_000 },
];
const trade = (day, trader = BUYER) => ({ signature: `sig${day}`, at: LAUNCH + day * DAY, trader, payer: trader });
const excluded = bonusExcluded(CREATOR, [{ wallet: MATE }], [RYNTRA]);

test("the rates of 25.10 make the ceiling exactly: 20 + 30 + 15 + 5 = 70 % of what Ryntra received", () => {
  assert.equal(ORBIT_BONUS_BPS, 2_000);
  assert.equal(LAUNCH_PAYOUT_CEILING_BPS, 7_000);
  assert.equal(Object.values(LAUNCH_PAYOUT_RATES_BPS).reduce((sum, bps) => sum + bps, 0), LAUNCH_PAYOUT_CEILING_BPS);
  assert.equal(ORBIT_BONUS_LIVE, false, "no bonus is accrued before the Growth line accrues it and the lawyer has answered");
});

test("the bonus is 20 % of what was received — the SPEC's month: $897.45 to Ryntra, about $180 to the crew by day 30", () => {
  assert.deepEqual(orbitBonusEntitlementRaw(usd(897.45), usd(0)), { raw: usd(179.49), capped: false });
  const tranche = orbitBonusTranche({ receivedRaw: usd(897.45), otherPayoutsRaw: usd(0), crew: CREW });
  assert.equal(tranche.dueRaw, usd(179.49));
  assert.deepEqual(tranche.parts, [
    { wallet: CREATOR, raw: usd(143.592) },
    { wallet: MATE, raw: usd(35.898) },
  ]);
});

test("inside the ceiling with every other payout: cashback, friend and partner at their rates leave the bonus whole", () => {
  const received = usd(100);
  const others = (received * 5_000n) / 10_000n;
  assert.deepEqual(orbitBonusEntitlementRaw(received, others), { raw: usd(20), capped: false });
  assert.equal(payoutRoomRaw(received, others + usd(20)), 0n, "the four rates together reach the ceiling and no further");
});

test("the ceiling cuts the bonus when other payouts took more than their rates («First $10 back»)", () => {
  assert.deepEqual(orbitBonusEntitlementRaw(usd(100), usd(60)), { raw: usd(10), capped: true });
  assert.deepEqual(orbitBonusEntitlementRaw(usd(100), usd(90)), { raw: 0n, capped: true }, "never below zero");
  const tranche = orbitBonusTranche({ receivedRaw: usd(100), otherPayoutsRaw: usd(60), crew: CREW });
  assert.ok(tranche.dueRaw + usd(60) <= (usd(100) * 7_000n) / 10_000n);
});

test("only from what was received: nothing received, nothing due — a share still in the pool is not received", () => {
  assert.equal(orbitBonusTranche({ receivedRaw: 0n, otherPayoutsRaw: 0n, crew: CREW }).dueRaw, 0n);
  assert.throws(() => orbitBonusEntitlementRaw(-1n, 0n));
  assert.throws(() => payoutRoomRaw(1n, -1n));
});

test("cumulative: a check settled twice pays nothing twice, and a row is never asked to give back", () => {
  const first = orbitBonusTranche({ receivedRaw: usd(50), otherPayoutsRaw: 0n, crew: CREW });
  const paid = new Map(first.parts.map((part) => [part.wallet, part.raw]));
  assert.equal(orbitBonusTranche({ receivedRaw: usd(50), otherPayoutsRaw: 0n, crew: CREW, paidRaw: paid }).dueRaw, 0n);
  const later = orbitBonusTranche({ receivedRaw: usd(150), otherPayoutsRaw: 0n, crew: CREW, paidRaw: paid });
  assert.equal(later.dueRaw, usd(20), "20 % of the $100 received since");
  const shrunk = orbitBonusTranche({ receivedRaw: usd(50), otherPayoutsRaw: usd(30), crew: CREW, paidRaw: paid });
  assert.deepEqual(shrunk.parts.map((part) => part.raw), [0n, 0n]);
});

test("rounding is down for each row; the dust stays with Ryntra", () => {
  const crew = [
    { wallet: CREATOR, bps: 3_333 },
    { wallet: MATE, bps: 3_333 },
    { wallet: BUYER, bps: 3_334 },
  ];
  const tranche = orbitBonusTranche({ receivedRaw: 50n, otherPayoutsRaw: 0n, crew });
  assert.equal(tranche.entitlementRaw, 10n);
  assert.deepEqual(tranche.parts.map((part) => part.raw), [3n, 3n, 3n]);
  assert.ok(tranche.dueRaw <= tranche.entitlementRaw);
});

test("a crew is one to five distinct wallets whose parts make 10 000", () => {
  assert.equal(checkedCrew([{ wallet: CREATOR, bps: 10_000 }]).length, 1, "a launch without a crew: the creator alone");
  assert.throws(() => checkedCrew([]));
  assert.throws(() => checkedCrew([{ wallet: CREATOR, bps: 9_000 }]));
  assert.throws(() => checkedCrew([{ wallet: CREATOR, bps: 5_000 }, { wallet: CREATOR, bps: 5_000 }]));
  assert.throws(() => checkedCrew([{ wallet: CREATOR, bps: 10_000.5 }]));
  assert.throws(() => checkedCrew(Array.from({ length: 6 }, (_, i) => ({ wallet: `W${i}`, bps: i === 0 ? 5_000 : 1_000 }))));
});

test("a check for the bonus: SOL-L3's week, the crew's own trades excluded, the market in orbit by the day", () => {
  const read = (trades, complete = true) => ({ trades, complete });
  const check = (days, trades, orbitAt, now = LAUNCH + 100 * DAY, complete = true) => bonusCheck({ days, launchedAt: LAUNCH, orbitAt, read: read(trades, complete), excluded, now });
  assert.equal(check(7, [trade(3)], LAUNCH + DAY).state, "passed");
  assert.equal(check(7, [trade(3)], LAUNCH + DAY).proof.signature, "sig3");
  assert.equal(check(7, [trade(3, MATE)], LAUNCH + DAY).state, "lost", "a crew member's trade proves nothing");
  assert.equal(check(7, [trade(3, RYNTRA)], LAUNCH + DAY).state, "lost");
  assert.equal(check(7, [trade(3)], null).state, "not-in-orbit", "alive on its curve: nothing now, it rolls on");
  assert.equal(check(7, [trade(3)], LAUNCH + 8 * DAY).state, "not-in-orbit", "orbit after the day does not count for it");
  assert.equal(check(7, [], LAUNCH + DAY, LAUNCH + 100 * DAY, false).state, "waiting", "a week not read whole is never lost");
  assert.equal(check(30, [trade(25)], LAUNCH + DAY, LAUNCH + 20 * DAY).state, "waiting", "the week is not over");
  assert.equal(bonusCutAt(LAUNCH, 30), LAUNCH + 30 * DAY);
});

test("the course: each passed check pays its tranche, the bonus so far less what was paid", () => {
  const course = orbitBonusCourse(
    [
      { days: 7, state: "passed", receivedRaw: usd(300), otherPayoutsRaw: usd(150) },
      { days: 30, state: "passed", receivedRaw: usd(900), otherPayoutsRaw: usd(450) },
      { days: 90, state: "passed", receivedRaw: usd(1_500), otherPayoutsRaw: usd(750) },
    ],
    CREW,
  );
  assert.deepEqual(course.steps.map((step) => [step.step, step.dueRaw]), [
    ["settled", usd(60)],
    ["settled", usd(120)],
    ["settled", usd(120)],
  ]);
  assert.equal(course.paidRaw, usd(300), "20 % of $1,500");
  assert.equal(course.ended, true);
  assert.equal(course.forfeitRaw, 0n);
});

test("the course: a check lived on the curve rolls on to the next one passed in orbit", () => {
  const course = orbitBonusCourse(
    [
      { days: 7, state: "not-in-orbit", receivedRaw: usd(100), otherPayoutsRaw: 0n },
      { days: 30, state: "passed", receivedRaw: usd(400), otherPayoutsRaw: 0n },
      { days: 90, state: "waiting", receivedRaw: 0n, otherPayoutsRaw: 0n },
    ],
    CREW,
  );
  assert.deepEqual(course.steps.map((step) => step.step), ["rolled", "settled", "waiting"]);
  assert.equal(course.steps[1].dueRaw, usd(80));
  assert.equal(course.ended, false);
});

test("the course: signal lost ends it; what the crew would have had is forfeit, never paid", () => {
  const course = orbitBonusCourse(
    [
      { days: 7, state: "passed", receivedRaw: usd(100), otherPayoutsRaw: 0n },
      { days: 30, state: "lost", receivedRaw: usd(400), otherPayoutsRaw: 0n },
      { days: 90, state: "passed", receivedRaw: usd(900), otherPayoutsRaw: 0n },
    ],
    CREW,
  );
  assert.deepEqual(course.steps.map((step) => step.step), ["settled", "lost", "closed"]);
  assert.equal(course.paidRaw, usd(20));
  assert.equal(course.forfeitRaw, usd(60), "20 % of $400 less the $20 paid at day 7");
  assert.equal(course.ended, true);
});

test("the course: a later check is never settled before an earlier one is decided", () => {
  const course = orbitBonusCourse(
    [
      { days: 7, state: "waiting", receivedRaw: usd(100), otherPayoutsRaw: 0n },
      { days: 30, state: "passed", receivedRaw: usd(400), otherPayoutsRaw: 0n },
    ],
    CREW,
  );
  assert.deepEqual(course.steps.map((step) => step.step), ["waiting", "closed", "closed"]);
  assert.equal(course.paidRaw, 0n);
});

test("the course: Day 90 lived off orbit ends it without a bonus", () => {
  const course = orbitBonusCourse(
    [
      { days: 7, state: "not-in-orbit", receivedRaw: usd(10), otherPayoutsRaw: 0n },
      { days: 30, state: "not-in-orbit", receivedRaw: usd(20), otherPayoutsRaw: 0n },
      { days: 90, state: "not-in-orbit", receivedRaw: usd(30), otherPayoutsRaw: 0n },
    ],
    CREW,
  );
  assert.equal(course.paidRaw, 0n);
  assert.equal(course.ended, true);
  assert.equal(course.forfeitRaw, usd(6));
});
