import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LAUNCH_PRESETS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { ryntraSets, termsOfPreset } from "../../../lib/launch/presets-market/set.ts";
import { appliedHere, changeRows, presetOfSet, reachableOf, setName, setsHere, sniperText, termsOfView } from "./sets-view.ts";
import { SET_WORDS } from "./words.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** A preset as the engine serves it (`launchPresetsView`), from the same numbers. */
function view(id, over = {}) {
  const preset = LAUNCH_PRESETS[id];
  return {
    id,
    name: preset.name,
    pair: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
    startMarketCapUsd: preset.curve.startMarketCapUsd,
    graduationMarketCapUsd: preset.curve.graduationMarketCapUsd,
    sniperFee: { startBps: preset.sniperFee.startBps, endBps: preset.sniperFee.endBps, seconds: preset.sniperFee.seconds },
    creatorTradingFeePct: preset.creatorTradingFeePct,
    graduationFee: preset.graduationFee,
    firstBuyCapBps: preset.creatorFirstBuyCapBps,
    creatorLockMinDays: preset.creatorLockMinDays,
    graduationQuote: null,
    technicalValidation: false,
    lpLockedForeverPct: 100,
    ...over,
  };
}

const FIG = { usd: (v) => `$${v / 1000}K`, pct: (bps) => `${bps / 100}%`, span: (s) => `${s / 60} min` };
const SERVED = { classic: view("classic"), protected: view("protected") };
const creatorSet = (terms, over = {}) => ({ id: "1b4e28ba-2fa1-4d2b-883f-0016d3cca427", name: "Night start", names: null, author: "So11111111111111111111111111111111111111112", terms, uses: 3, createdAt: null, ...over });

test("a set takes the form only to a preset it may take, served here with exactly the set's numbers", () => {
  const [classic, protectedSet, micro] = ryntraSets(["classic", "protected", "micro"]);
  assert.equal(presetOfSet(classic, SERVED), "classic");
  assert.equal(presetOfSet(protectedSet, SERVED), "protected");
  assert.equal(presetOfSet(micro, SERVED), null, "Micro needs the creator's lock the form does not give");
  assert.equal(presetOfSet(creatorSet({ ...termsOfPreset("classic"), creatorTradingFeePct: 30, curve: "own" }), SERVED), null, "an own curve is not the form's yet");
  assert.equal(presetOfSet(classic, { classic: view("classic", { creatorTradingFeePct: 30 }) }), null, "a served preset with other numbers");
  assert.equal(presetOfSet(classic, { classic: null, protected: SERVED.protected }), null, "not served");
});

test("the form's own choices are the limit: both presets with the shield switch, else only the one it stands on", () => {
  assert.deepEqual(reachableOf(SERVED, SERVED.protected, true), SERVED);
  assert.deepEqual(reachableOf(SERVED, SERVED.classic, false), { classic: SERVED.classic });
  assert.deepEqual(reachableOf(SERVED, null, false), {});
  const sets = [...ryntraSets(["classic", "protected", "micro"]), creatorSet(termsOfPreset("protected"))];
  assert.deepEqual(setsHere(sets, reachableOf(SERVED, SERVED.classic, true)).map((set) => set.id), ["ryntra-classic", "ryntra-protected", "1b4e28ba-2fa1-4d2b-883f-0016d3cca427"]);
  assert.deepEqual(setsHere(sets, reachableOf(SERVED, SERVED.classic, false)).map((set) => set.id), ["ryntra-classic"]);
  assert.equal(setsHere(sets, SERVED, 2).length, 2);
});

test("the form stands on a set only while its numbers are still the set's", () => {
  const set = creatorSet(termsOfPreset("protected"));
  assert.equal(appliedHere(set, SERVED.protected), set);
  assert.equal(appliedHere(set, SERVED.classic), null, "the shield switched back");
  assert.equal(appliedHere(null, SERVED.protected), null);
  assert.equal(termsOfView(view("micro")), null);
});

test("what a set changes from the launch the form opens with: each number from and to", () => {
  assert.deepEqual(changeRows(termsOfPreset("protected"), termsOfPreset("classic"), FIG), [{ field: "sniper", from: "20% · 2 min", to: "50% · 10 min" }]);
  assert.deepEqual(changeRows(termsOfPreset("classic"), termsOfPreset("classic"), FIG), []);
  assert.deepEqual(changeRows(termsOfPreset("classic"), null, FIG), []);
  assert.equal(sniperText(termsOfPreset("classic"), FIG), "20% · 2 min");
  const [classic] = ryntraSets(["classic"]);
  assert.equal(setName(classic, "uk"), "Класичний");
  assert.equal(setName(creatorSet(termsOfPreset("classic")), "uk"), "Night start");
});

test("the screen says nothing about a price of a set, and none of the words is technical", () => {
  for (const lang of ["en", "uk"]) {
    for (const value of Object.values(SET_WORDS[lang])) {
      const said = typeof value === "string" ? value : value(2, "2");
      assert.doesNotMatch(said, /price|cost|lamport|\bSOL\b|ціна|варт|оплат|плата/i, `${lang}: «${said}»`);
      assert.doesNotMatch(said, /signature|transaction|address|uuid|terms_key|\bid\b/i, `${lang}: «${said}»`);
    }
  }
  assert.equal(SET_WORDS.uk.launches(5, "5"), "5 запусків");
  assert.equal(SET_WORDS.en.launches(1, "1"), "1 launch");
});

test("the form mounts the row once; the row has no amber action and writes no corner of its own", () => {
  const form = read("../Form.tsx");
  assert.equal((form.match(/<StartFromSet m=\{m\} \/>/g) ?? []).length, 1);
  const row = read("./StartFromSet.tsx");
  assert.doesNotMatch(row, /\bAction\b/, "the screen's one amber action stays the launch");
  assert.doesNotMatch(read("./sets.module.css").replace(/\/\*[\s\S]*?\*\//g, ""), /border-radius|clip-path|#[0-9a-f]{3,8}\b|rgba?\(/i);
  const hook = read("./useSets.ts");
  assert.doesNotMatch(hook, /signTransaction|signAndSend|sendTransaction/, "a set is a message, never a transaction");
  assert.match(hook, /citySigner\.signIn\(/);
});
