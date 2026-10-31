import { test } from "node:test";
import assert from "node:assert/strict";

import { EARN_OPEN, EARN_TABS, earnOpen, isEarnTab, PRODUCTS, RISK } from "./flag.ts";
import { closeEarn, openEarn, useEarn } from "./open.ts";
import { langOf, WORDS } from "./words.ts";

test("the Earn switch opens only on the exact word «open»", () => {
  assert.equal(earnOpen("open"), true);
  assert.equal(earnOpen(" open\n"), true);
  for (const value of [undefined, "", "on", "OPEN", "true", "1", "opened"]) assert.equal(earnOpen(value), false, String(value));
  assert.equal(EARN_OPEN, false, "closed by default");
  assert.deepEqual(EARN_TABS, ["shelf", "piers", "mine"]);
  assert.equal(isEarnTab("piers"), true);
  assert.equal(isEarnTab("pools"), false);
  for (const id of PRODUCTS) assert.ok(RISK[id] >= 1 && RISK[id] <= 3);
});

test("openEarn is the one door: a tab, a product, and a signature that holds the window", () => {
  useEarn.setState({ open: false, tab: "shelf", product: null, busy: false });
  openEarn("mine");
  assert.deepEqual([useEarn.getState().open, useEarn.getState().tab], [true, "mine"]);
  openEarn("shelf", "saver");
  assert.equal(useEarn.getState().product, "saver");
  openEarn();
  assert.deepEqual([useEarn.getState().tab, useEarn.getState().product], ["shelf", "saver"], "without a tab it opens where it was");
  openEarn("shelf");
  assert.equal(useEarn.getState().product, null, "a tab asked for opens on its own home");
  openEarn("shelf", "saver");
  useEarn.getState().setBusy(true);
  openEarn("piers");
  useEarn.getState().setTab("mine");
  closeEarn();
  assert.deepEqual([useEarn.getState().open, useEarn.getState().tab, useEarn.getState().product], [true, "shelf", "saver"], "mid-signature nothing moves");
  useEarn.getState().setBusy(false);
  closeEarn();
  assert.equal(useEarn.getState().open, false);
  openEarn("bogus");
  assert.deepEqual([useEarn.getState().tab, useEarn.getState().product], ["shelf", "saver"], "an unknown tab is no tab");
});

test("the words follow the browser: Ukrainian first, English otherwise, and both have every key", () => {
  assert.equal(langOf(["uk-UA", "en"]), "uk");
  assert.equal(langOf(["en-US", "uk"]), "en");
  assert.equal(langOf([]), "en");
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(WORDS.uk), keys(WORDS.en));
  for (const k of ["saver", "piers", "mine", "products", "tabs"]) assert.deepEqual(keys(WORDS.uk[k]), keys(WORDS.en[k]), k);
  for (const words of Object.values(WORDS)) {
    const text = JSON.stringify(words);
    assert.doesNotMatch(text, /\bsoon\b|згодом|guarantee|гарант/i, "no «soon», no promise");
  }
});
