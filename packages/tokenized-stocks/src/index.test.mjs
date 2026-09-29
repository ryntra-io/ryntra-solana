/**
 * Network-free tests over the tokenized-stock model, run against the same
 * sources the package exports. Every figure below is computed by hand in the
 * comment beside it, so a change in the arithmetic fails on a number rather
 * than on a snapshot.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  LIFECYCLE_EVENTS,
  LIFECYCLE_UNKNOWN,
  NO_FEE_CAP_RAW,
  deviationPct,
  isScaledMultiplier,
  lifecycleEventFor,
  lifecycleOf,
  markPremiumPct,
  multiplierFromChain,
  multiplierFromMint,
  multiplierRatio,
  multiplierState,
  perShareExecutable,
  perShareFromTokenPrice,
  rawFromScaledRaw,
  referenceState,
  referenceStateOf,
  scaledAmountString,
  sessionFromIssuer,
  transferFeeOf,
} from "./index.ts";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");

/* ---------------------------------------------------------------- units */

test("a multiplier becomes an exact ratio of integers", () => {
  assert.deepEqual(multiplierRatio(1), { num: 1n, den: 1n });
  assert.deepEqual(multiplierRatio(2.5), { num: 5n, den: 2n });
  /* 1.486135 = 1486135 / 1000000 = 297227 / 200000 after the gcd of 5. */
  assert.deepEqual(multiplierRatio(1.486135), { num: 297227n, den: 200000n });
  assert.throws(() => multiplierRatio(0), /positive finite/);
  assert.throws(() => multiplierRatio(Number.NaN), /positive finite/);
});

test("the scaled amount is raw × multiplier / 10^decimals, truncated toward zero", () => {
  /* 1_000_000 raw at 6 decimals is one base token; × 1.486135 = 1.486135 units. */
  assert.equal(scaledAmountString(1_000_000n, 6, 1.486135), "1.486135");
  /* Truncation, never rounding up: 1 raw at 6 decimals × 2.5 = 0.0000025 → 0.000002. */
  assert.equal(scaledAmountString(1n, 6, 2.5), "0.000002");
  assert.equal(scaledAmountString(0n, 6, 3), "0.000000");
  assert.equal(scaledAmountString(123_456_789n, 8, 1, 4), "1.2345");
  assert.throws(() => scaledAmountString(-1n, 6, 1), /negative/);
});

test("the raw amount behind a typed scaled count divides by the multiplier once", () => {
  /* 1.486135 scaled units typed at 6 decimals = 1486135 scaled raw → 1486135 × 200000 / 297227 = 1_000_000 raw. */
  assert.equal(rawFromScaledRaw(1_486_135n, 1.486135), 1_000_000n);
  assert.equal(rawFromScaledRaw(5_000n, 1), 5_000n);
  /* Truncation toward zero: 1 scaled raw over 2.5 is 0.4 raw → 0. */
  assert.equal(rawFromScaledRaw(1n, 2.5), 0n);
});

test("a multiplier of one changes nothing and is not a scaled multiplier", () => {
  assert.equal(isScaledMultiplier(1), false);
  assert.equal(isScaledMultiplier(1.0000000001), false);
  assert.equal(isScaledMultiplier(1.486135), true);
  assert.equal(isScaledMultiplier(null), false);
});

test("the chain's two multipliers resolve by the clock", () => {
  const before = multiplierFromChain({ multiplier: 1, newMultiplier: 2, newMultiplierEffectiveAt: "2026-09-16T13:00:00.000Z" }, T0);
  assert.deepEqual(before, { current: 1, pending: 2, effectiveAt: "2026-09-16T13:00:00.000Z" });
  const after = multiplierFromChain({ multiplier: 1, newMultiplier: 2, newMultiplierEffectiveAt: "2026-09-16T11:00:00.000Z" }, T0);
  assert.deepEqual(after, { current: 2, pending: null, effectiveAt: null });
  const none = multiplierFromChain({ multiplier: 1.5, newMultiplier: 0, newMultiplierEffectiveAt: null }, T0);
  assert.deepEqual(none, { current: 1.5, pending: null, effectiveAt: null });
});

test("a mint without the extension is one-to-one; an unread mint is unknown", () => {
  assert.deepEqual(multiplierFromMint({ scaledUi: null }, T0), { current: 1, pending: null, effectiveAt: null });
  assert.equal(multiplierFromMint(null, T0), null);
});

test("the activation window is fifteen minutes either side of the pending time", () => {
  const pending = { current: 1, pending: 2, effectiveAt: new Date(T0 + 10 * 60 * 1000).toISOString() };
  assert.equal(multiplierState(pending, T0), "activation-window");
  const later = { current: 1, pending: 2, effectiveAt: new Date(T0 + 60 * 60 * 1000).toISOString() };
  assert.equal(multiplierState(later, T0), "pending");
  assert.equal(multiplierState({ current: 1, pending: null, effectiveAt: null }, T0), "active");
});

test("prices are put on one basis before they are compared", () => {
  /* A token at $317.61 that stands for 1.486135 shares is a share at $213.72 (rounded). */
  assert.equal(perShareFromTokenPrice(317.61, 1.486135).toFixed(2), "213.72");
  assert.equal(perShareFromTokenPrice(0, 1.5), null);
  /* $1,000 for 4.668673 shares is $214.19 per share. */
  assert.equal(perShareExecutable(1000, "4.668673").toFixed(2), "214.19");
  assert.equal(perShareExecutable(1000, "0"), null);
  /* (214.19 / 213.03 − 1) × 100 = 0.5445…% */
  assert.equal(deviationPct(214.19, 213.03).toFixed(2), "0.54");
  assert.equal(deviationPct(214.19, null), null);
  assert.equal(deviationPct(214.19, 0), null);
});

/* --------------------------------------------------------- transfer fee */

const config = {
  older: { epoch: "1000", basisPoints: 20, maximumFeeRaw: NO_FEE_CAP_RAW },
  newer: { epoch: "1035", basisPoints: 50, maximumFeeRaw: "1000000" },
};

test("the transfer fee follows the token program's rule on the epoch", () => {
  const before = transferFeeOf(config, 1034n);
  assert.equal(before.basisPoints, 20);
  assert.equal(before.configUsed, "OLDER");
  assert.deepEqual(before.pending, { basisPoints: 50, maximumFeeRaw: "1000000", fromEpoch: "1035" });
  const from = transferFeeOf(config, 1035n);
  assert.equal(from.basisPoints, 50);
  assert.equal(from.configUsed, "NEWER");
  assert.equal(from.pending, null);
  /* An unknown epoch assumes the newer config and says so. */
  const unknown = transferFeeOf(config, null);
  assert.equal(unknown.configUsed, "NEWER");
  assert.equal(unknown.epoch, null);
  assert.equal(transferFeeOf(null, 1035n), null);
});

/* ------------------------------------------------------------ lifecycle */

const event = LIFECYCLE_EVENTS.find((entry) => entry.state === "conversion-open");

test("the lifecycle registry is read through one function", () => {
  assert.ok(event, "the registry carries a conversion window");
  assert.equal(lifecycleEventFor(event.mint), event);
  assert.equal(lifecycleEventFor("11111111111111111111111111111111"), null);
  for (const entry of LIFECYCLE_EVENTS) {
    assert.match(entry.url, /^https:\/\//, `${entry.mint} has no issuer notice`);
    assert.ok(Date.parse(entry.observedAt) > 0, `${entry.mint} has no read time`);
  }
});

test("a chain pause outranks an issuer event, which outranks the catalogue", () => {
  const paused = lifecycleOf({ paused: true, event, listedByIssuer: true, catalogueFetchedAt: "2026-09-16T11:00:00.000Z", chainObservedAt: "2026-09-16T11:05:00.000Z" });
  assert.equal(paused.state, "paused");
  assert.equal(paused.tradable, false);
  assert.equal(paused.source, "chain");

  const window = lifecycleOf({ paused: false, event, listedByIssuer: true, catalogueFetchedAt: null, chainObservedAt: null, nowMs: T0 });
  assert.equal(window.state, "conversion-open");
  assert.equal(window.tradable, true);
  assert.equal(window.url, event.url);
  assert.equal(window.deadline, event.deadline);

  const listed = lifecycleOf({ paused: false, event: null, listedByIssuer: true, catalogueFetchedAt: "2026-09-16T11:00:00.000Z", chainObservedAt: null });
  assert.equal(listed.state, "active");
  assert.equal(listed.source, "issuer-catalogue");

  assert.deepEqual(lifecycleOf({ paused: null, event: null, listedByIssuer: false, catalogueFetchedAt: null, chainObservedAt: null }), LIFECYCLE_UNKNOWN);
});

test("a conversion window is expired once the clock passes the issuer's cut-off", () => {
  const past = Date.parse(event.deadline) + 1;
  const expired = lifecycleOf({ paused: false, event, listedByIssuer: true, catalogueFetchedAt: null, chainObservedAt: null, nowMs: past });
  assert.equal(expired.state, "expired");
  assert.equal(expired.tradable, false);
});

/* ------------------------------------------------------- issuer's mark */

test("the mark premium is context, computed only from two positive figures", () => {
  /* (980.96 / 963.96 − 1) × 100 = 1.7635…% */
  assert.equal(markPremiumPct(980.96, 963.96).toFixed(2), "1.76");
  assert.equal(markPremiumPct(null, 963.96), null);
  assert.equal(markPremiumPct(980.96, 0), null);
});

/* -------------------------------------------------------------- session */

test("a reference state never promotes itself", () => {
  const fetched = new Date(T0 - 60 * 1000).toISOString();
  assert.equal(referenceState({ perShare: 213.03, fetchedAt: fetched, exchangeOpen: true, nowMs: T0 }), "current");
  assert.equal(referenceState({ perShare: 213.03, fetchedAt: fetched, exchangeOpen: false, nowMs: T0 }), "last-available");
  assert.equal(referenceState({ perShare: 213.03, fetchedAt: fetched, exchangeOpen: null, nowMs: T0 }), "last-available");
  const old = new Date(T0 - 6 * 60 * 1000).toISOString();
  assert.equal(referenceState({ perShare: 213.03, fetchedAt: old, exchangeOpen: true, nowMs: T0 }), "stale");
  assert.equal(referenceState({ perShare: null, fetchedAt: fetched, exchangeOpen: true, nowMs: T0 }), "unavailable");
});

test("freshness is judged from the source's observation time when it states one", () => {
  const reference = { perShare: 213.03, observedAt: new Date(T0 - 10 * 60 * 1000).toISOString(), fetchedAt: new Date(T0 - 1000).toISOString() };
  assert.equal(referenceStateOf(reference, true, T0), "stale");
  assert.equal(referenceStateOf({ ...reference, observedAt: null }, true, T0), "current");
});

test("the issuer's period words map to a session and unknown words stay unknown", () => {
  const session = sessionFromIssuer({ currentPeriod: "extended", openNow: true, nextChangeAt: "2026-09-16T13:30:00.000Z", exchange: { mic: "XNAS", name: "Nasdaq Stock Market", timezone: "America/New_York" } });
  assert.equal(session.period, "extended");
  assert.equal(session.source, "issuer");
  assert.equal(sessionFromIssuer({ currentPeriod: "lunch", openNow: null, nextChangeAt: null, exchange: null }).period, "unknown");
  assert.equal(sessionFromIssuer(null).source, "none");
});
