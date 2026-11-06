import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkLaunchForm } from "../../../lib/launch/form.ts";
import { tickerAfterName, tickerFromName } from "./ticker.ts";

/* CITY-200: on ryntra.io the sheet kept «$KITE» (its placeholder) over a coin named «QA Moon» and refused «Give it a ticker.» */
test("a name typed offers its ticker, one the engine's rules take", () => {
  assert.equal(tickerFromName("QA Moon"), "QAMOON");
  assert.equal(tickerFromName("Golden Orca 2"), "GOLDENORCA");
  assert.equal(tickerFromName("Кіт"), "KIT");
  assert.equal(tickerFromName("Ще один пес"), "SHCHEODYNP");
  assert.equal(tickerFromName("Café 🚀"), "CAFE");
  assert.equal(tickerFromName("🚀🚀"), "");
  for (const name of ["QA Moon", "Кіт у чоботях", "Café 🚀", "x".repeat(40)]) {
    const symbol = tickerFromName(name);
    assert.equal(checkLaunchForm({ name: "A", symbol, description: "", website: "", x: "", telegram: "" }).problems.symbol, undefined, `«${name}» → ${symbol}`);
  }
});

test("the person's own ticker is never written over", () => {
  assert.equal(tickerAfterName("", "Q", ""), "Q");
  assert.equal(tickerAfterName("Q", "QA Moon", "Q"), "QAMOON", "still the offered one: it follows the name");
  assert.equal(tickerAfterName("QA Moon", "QA Moo", "MOON"), "MOON", "typed by the person: kept");
  assert.equal(tickerAfterName("QA Moon", "", "QAMOON"), "", "the name cleared, the offer goes with it");
});

test("the sheet's name field offers the ticker", () => {
  const sheet = readFileSync(new URL("../../components/launch/LaunchSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /setDraft\(\{ name: event\.target\.value, symbol: tickerAfterName\(draft\.name, event\.target\.value, draft\.symbol\) \}\)/);
});
