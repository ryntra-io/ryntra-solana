import assert from "node:assert/strict";
import test from "node:test";

import { launchNameHits } from "./moderation.ts";

const labels = (name, symbol = "CAT") => launchNameHits({ name, symbol }).map((hit) => `${hit.field}:${hit.label}`);

test("a known brand or person is refused by name or ticker", () => {
  assert.deepEqual(labels("Tesla"), ["name:Tesla"]);
  assert.deepEqual(labels("Cat", "TSLA"), ["symbol:Tesla"]);
  assert.deepEqual(labels("Elon Musk"), ["name:Elon Musk"]);
  assert.deepEqual(labels("Official Trump", "TRUMP"), ["name:Donald Trump", "symbol:Donald Trump"]);
  assert.deepEqual(labels("Ryntra"), ["name:Ryntra"]);
  assert.deepEqual(labels("Cat", "SOL"), ["symbol:Solana"]);
  assert.deepEqual(labels("Cat", "USDC"), ["symbol:USDC"]);
});

test("a disguised name is still the name", () => {
  assert.deepEqual(labels("T3SLA"), ["name:Tesla"]);
  assert.deepEqual(labels("E.L.O.N  M-u-s-k"), ["name:Elon Musk"]);
  assert.deepEqual(labels("ElonMuskInu"), ["name:Elon Musk"]);
  assert.deepEqual(labels("Теsla"), ["name:Tesla"], "a Cyrillic «Т» and «е»");
  assert.deepEqual(labels("BabyTrump"), ["name:Donald Trump"]);
  assert.deepEqual(labels("Cat", "$TRUMP"), ["symbol:Donald Trump"]);
  assert.deepEqual(labels("TRUMP2025"), ["name:Donald Trump"]);
  assert.deepEqual(labels("Nvidiа Coin"), ["name:Nvidia"]);
  assert.deepEqual(labels("Ryntra Official", "RYN"), ["name:Ryntra", "symbol:Ryntra"]);
});

test("an ordinary meme name passes, also when it only shares letters with a protected one", () => {
  for (const [name, symbol] of [
    ["Moon Cat", "MCAT"],
    ["Trumpet Frog", "TRMPT"],
    ["Messiah", "MSH"],
    ["Solar Panel", "SOLAR"],
    ["Sol Cat", "SOLCAT"],
    ["Metamorph", "MORPH"],
    ["Popeye", "POPE"],
    ["Kotyk", "КОТ"],
    ["Visage", "VSG"],
  ]) {
    if (name === "Popeye") {
      /* «POPE» is the whole ticker: it reads as the protected word itself. */
      assert.deepEqual(labels(name, symbol), ["symbol:Pope Leo"]);
      continue;
    }
    assert.deepEqual(labels(name, symbol), [], `${name} / ${symbol}`);
  }
});

test("empty fields are not judged", () => {
  assert.deepEqual(launchNameHits({ name: "", symbol: "" }), []);
  assert.deepEqual(launchNameHits({ name: "   ", symbol: "" }), []);
});

test("written in Cyrillic, a known person or brand is still refused", () => {
  assert.deepEqual(labels("Трамп"), ["name:Donald Trump"]);
  assert.deepEqual(labels("Ілон Маск"), ["name:Elon Musk"]);
  assert.deepEqual(labels("Илон Маск Ину"), ["name:Elon Musk"]);
  assert.deepEqual(labels("Зеленський"), ["name:Volodymyr Zelensky"]);
  assert.deepEqual(labels("Путін"), ["name:Vladimir Putin"]);
  assert.deepEqual(labels("Біткоїн Кіт"), ["name:Bitcoin"]);
  assert.deepEqual(labels("Райнтра"), ["name:Ryntra"]);
  assert.deepEqual(labels("Musk Cat"), ["name:Elon Musk"]);
  assert.deepEqual(labels("Barron"), ["name:Donald Trump"]);
  assert.deepEqual(labels("Obama Inu"), ["name:Barack Obama"]);
  assert.deepEqual(labels("CZ Dog"), ["name:Changpeng Zhao"]);
  assert.deepEqual(labels("Grok"), ["name:xAI"]);
  assert.deepEqual(labels("Елон"), ["name:Elon Musk"]);
  assert.deepEqual(labels("Bonk Inu"), ["name:Bonk"]);
  for (const ticker of ["DOGE", "SHIB", "PEPE", "WLFI", "USD1"]) assert.equal(labels("Cat", ticker).length, 1, ticker);
});

test("ordinary words that a brand also uses pass: the brand is refused only as itself", () => {
  for (const [name, symbol] of [
    ["Crop Circle", "CROP"],
    ["Coin", "KOIN"],
    ["Hype", "HYP"],
    ["Ray of Sun", "SUN"],
    ["Kraken Cat", "KRKN"],
    ["Tethered", "TTHR"],
    ["Amazonia", "AMZA"],
    ["Jupiter Moon", "JMOON"],
    ["Phantom Cat", "PHCAT"],
    ["Apple Pie", "PIE"],
    ["Маска", "MASKA"],
    ["Трампліна", "TRMP"],
    ["Кіт", "KIT"],
  ]) {
    assert.deepEqual(labels(name, symbol), [], `${name} / ${symbol}`);
  }
  assert.deepEqual(labels("Kraken"), ["name:Kraken"]);
  assert.deepEqual(labels("Jupiter"), ["name:Jupiter"]);
  assert.deepEqual(labels("Tether Cat"), ["name:Tether"]);
});
