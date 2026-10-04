// Run from repo root: node --test lib/markets/passport.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  CORPORATE_ACTION_WORDING,
  basedPrice,
  divergence,
  economicRepresentation,
} from "./passport.ts";

/**
 * The registry calls this row the single easiest place in the product to be
 * wrong by orders of magnitude, and this file is where that is prevented.
 *
 * The live numbers behind every assertion, read from Robinhood Chain and the
 * venue on 2026-08-19: `AAPL` carries `uiMultiplier = 1000566080061092436`,
 * and five of forty sampled equities are already off unity. Nothing here is a
 * hypothetical about a future split.
 */

const AAPL_MULTIPLIER = "1000566080061092436";

test("two prices on different bases cannot be compared, and the refusal states why", () => {
  const token = basedPrice("token", 310.26, "chainlink:oracle-feed");
  const share = basedPrice("underlying-share", 310.085, "arcus:spot-overview");

  const result = divergence(token, share);
  assert.equal(result.comparable, false, "a token price and a share price must not produce a number");
  assert.match(result.reason, /multiplier/i, "the refusal must say what the difference would actually be");

  /* And the same pair on one basis does compare. The rule is not "never
     compare" — it is "never compare across bases". */
  const same = divergence(
    basedPrice("underlying-share", 310.26, "derived"),
    basedPrice("underlying-share", 310.085, "arcus:spot-overview"),
  );
  assert.equal(same.comparable, true);
  assert.ok(Math.abs(same.percent) < 1);
});

test("the per-share equivalent divides the multiplier back out", () => {
  /* `AAPL`'s multiplier is 1.000566080061. A token worth 310.26 is 310.085 per
     underlying share. Reporting the first as a share price overstates it by
     the multiplier — small today, a factor after a split. */
  const rep = economicRepresentation({
    uiMultiplier: AAPL_MULTIPLIER,
    oracleTokenPrice: 310.26,
    venueQuotePrice: 310.085,
  });

  assert.equal(rep.hasDrift, true);
  assert.ok(Math.abs(rep.multiplierX - 1.000566080061) < 1e-9);

  assert.equal(rep.tokenPrice.known, true);
  assert.equal(rep.tokenPrice.value.basis, "token");
  assert.equal(rep.perShareEquivalent.known, true);
  assert.equal(rep.perShareEquivalent.value.basis, "underlying-share");
  assert.ok(rep.perShareEquivalent.value.value < rep.tokenPrice.value.value, "dividing the multiplier out lowers it");

  /* The only divergence the page may show is share against share. */
  assert.equal(rep.underlyingDivergence.comparable, true);
  assert.equal(rep.underlyingDivergence.basis, "underlying-share");
});

test("an unread multiplier does not silently become 1.0", () => {
  /*
   * The quiet version of the same defect. If the on-chain read fails and the
   * code assumes 1.0, the token price is published as a share price and looks
   * completely ordinary — no error, no gap, just a wrong number.
   */
  const rep = economicRepresentation({
    uiMultiplier: null,
    oracleTokenPrice: 310.26,
    venueQuotePrice: 310.085,
  });

  assert.equal(rep.perShareEquivalent.known, false, "no multiplier means no per-share equivalent");
  assert.match(rep.perShareEquivalent.reason, /multiplier could not be read/);
  assert.equal(rep.underlyingDivergence, null, "and nothing to compare against the venue quote");
});

test("a missing price is Unknown rather than zero, on either side", () => {
  const noOracle = economicRepresentation({
    uiMultiplier: AAPL_MULTIPLIER,
    oracleTokenPrice: null,
    venueQuotePrice: 310.085,
  });
  assert.equal(noOracle.tokenPrice.known, false);
  assert.equal(noOracle.perShareEquivalent.known, false);
  assert.equal(noOracle.underlyingDivergence, null);
  assert.equal(noOracle.venueQuote.known, true);

  const noVenue = economicRepresentation({
    uiMultiplier: AAPL_MULTIPLIER,
    oracleTokenPrice: 310.26,
    venueQuotePrice: null,
  });
  assert.equal(noVenue.venueQuote.known, false);
  assert.equal(noVenue.underlyingDivergence, null, "one side missing means no divergence, not a zero one");
});

test("a unity multiplier still reports both bases rather than collapsing them", () => {
  /* `TSLA`, `AMD`, `NVDA` and `SPY` all read exactly 1.0 today. The temptation
     is to show one number when the two agree — and then the page silently
     changes shape the day a dividend lands, which is the day it matters most. */
  const rep = economicRepresentation({
    uiMultiplier: "1000000000000000000",
    oracleTokenPrice: 336.04,
    venueQuotePrice: 336.045,
  });
  assert.equal(rep.hasDrift, false);
  assert.equal(rep.tokenPrice.value.basis, "token");
  assert.equal(rep.perShareEquivalent.value.basis, "underlying-share");
  assert.ok(Math.abs(rep.perShareEquivalent.value.value - rep.tokenPrice.value.value) < 1e-9);
});

test("every price carries its own source, and no composite score exists", () => {
  const rep = economicRepresentation({
    uiMultiplier: AAPL_MULTIPLIER,
    oracleTokenPrice: 310.26,
    venueQuotePrice: 310.085,
  });
  assert.match(rep.tokenPrice.value.source, /oracle/);
  assert.match(rep.perShareEquivalent.value.source, /derived/);
  assert.match(rep.venueQuote.value.source, /arcus/);

  /* The Passport rule: every fact has its own source and status, no
     "92/100 green score". A scored Passport is advice wearing evidence. */
  const source = JSON.stringify(rep);
  assert.doesNotMatch(source, /\bscore\b|\brating\b|\bgrade\b/i);
});

test("an unreadable corporate action is not worded as none scheduled", () => {
  /* The library already returns `unknown` for a failed sub-read. The wording
     is asserted because the failure here is editorial rather than logical: the
     honest status is useless if the sentence next to it reads reassuringly. */
  assert.match(CORPORATE_ACTION_WORDING.unknown, /not the same as none scheduled/i);
  assert.match(CORPORATE_ACTION_WORDING.none, /same multiplier now and next/i);
  assert.match(CORPORATE_ACTION_WORDING.paused, /not applied yet/i);
  for (const wording of Object.values(CORPORATE_ACTION_WORDING)) {
    assert.doesNotMatch(wording, /\bsafe\b|\bfine\b|\bno risk\b/i, "a status is not a reassurance");
  }
});

test("drift is never called a premium", () => {
  /*
   * A multiplier above 1.0 puts the token price above the share price by
   * design — dividends absorbed into the token. Calling that a premium invites
   * a reader to trade a difference that is not an opportunity.
   */
  const source = JSON.stringify({ ...economicRepresentation({
    uiMultiplier: AAPL_MULTIPLIER, oracleTokenPrice: 310.26, venueQuotePrice: 310.085,
  }), wording: CORPORATE_ACTION_WORDING });
  assert.doesNotMatch(source, /premium|discount/i);
});
