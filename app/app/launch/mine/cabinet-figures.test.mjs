import assert from "node:assert/strict";
import test from "node:test";

import { periodTotals } from "./cabinet-figures.ts";

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, dollar: true };
const source = (earnedRaw) => ({ earnedRaw, unclaimedRaw: "0" });
const earnings = (curve, shareBps = 10_000) => ({
  role: { curve: source(curve), graduation: source("0"), lp: source("0"), earnedRaw: curve, unclaimedRaw: "0" },
  mine: { shareBps, earnedRaw: curve, unclaimedRaw: "0", claimedRaw: "0" },
});
const row = (token, over = {}) => ({ token, role: "creator", pair: USDC, earnings: earnings("1000000"), feeSharing: null, ...over });
const windows = (curve) => ({ curve: { raw: curve, atLeast: false }, graduation: { raw: "0", atLeast: false }, lp: { raw: "0", atLeast: false } });
const stats = (curve) => ({ revenue: { day: windows(curve), week: windows(curve) } });

test("a period's total over the launches: exact when every one was read", () => {
  const [total] = periodTotals([row("A"), row("B")], { A: stats("10"), B: stats("5") }, "day");
  assert.deepEqual(total.total, { raw: "15", atLeast: false });
  assert.equal(total.unread, 0);
});

test("a launch not read makes the total a floor — never an exact sum of the others", () => {
  const sharedUnread = row("C", { earnings: null, feeSharing: { vault: "V", shares: [], signature: null, state: "SHARED", reason: null } });
  const [all] = periodTotals([row("A"), sharedUnread], { A: stats("10"), C: stats("7") }, "all");
  assert.equal(all.unread, 1);
  assert.deepEqual(all.total, { raw: "1000000", atLeast: true });
  const [day] = periodTotals([row("A"), row("B")], { A: stats("10"), B: "unread" }, "day");
  assert.deepEqual(day.total, { raw: "10", atLeast: true });
  /* A floor of nothing says nothing. */
  const [none] = periodTotals([row("A")], { A: "unread" }, "day");
  assert.deepEqual(none.total, { raw: null, atLeast: false });
});

test("a sharing not confirmed yet, or a part of nothing, is not the wallet's and is left out", () => {
  const waiting = row("W", { role: "recipient", earnings: null, feeSharing: { vault: "V", shares: [], signature: null, state: "PENDING", reason: null } });
  const nothing = row("N", { role: "recipient", earnings: earnings("9", 0) });
  const [total] = periodTotals([row("A"), waiting, nothing], { A: stats("10"), W: stats("1"), N: stats("1") }, "day");
  assert.deepEqual(total.total, { raw: "10", atLeast: false });
  assert.equal(total.unread, 0);
});

test("SOL-L1d: the curve's surplus is counted in all time, never in a day's or a week's window", () => {
  const withSurplus = (curve, surplus) => ({
    role: { curve: source(curve), graduation: source("0"), lp: source("0"), surplus: source(surplus), earnedRaw: String(BigInt(curve) + BigInt(surplus)), unclaimedRaw: "0" },
    mine: { shareBps: 10_000, earnedRaw: String(BigInt(curve) + BigInt(surplus)), unclaimedRaw: "0", claimedRaw: "0" },
  });
  const rows = [row("A", { earnings: withSurplus("1000000", "250000") }), row("B")];
  const [all] = periodTotals(rows, { A: stats("10"), B: stats("5") }, "all");
  assert.deepEqual(all.sources.surplus, { raw: "250000", atLeast: false });
  assert.deepEqual(all.total, { raw: "2250000", atLeast: false }, "all time is what the cabinet's counters earned, the surplus with it");
  const [day] = periodTotals(rows, { A: stats("10"), B: stats("5") }, "day");
  assert.equal(day.sources.surplus, undefined);
  assert.deepEqual(day.total, { raw: "15", atLeast: false });
});
