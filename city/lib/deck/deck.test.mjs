import { test } from "node:test";
import assert from "node:assert/strict";

import { CENTER, CHROME_KEY, LEFT, PLACES, RIGHT, SHOWN, TRAYS, doorOpen, doorsOf, futuresWay, isTray, placeOpen, readChrome, writeChrome } from "./items.ts";
import { DECK } from "../../components/deck/words.ts";

const ALL_SHUT = { launch: false, earn: false, guard: false, money: false, trade: false, spot: false, futures: null, hangar: false, bots: false, garage: false, ring: false, hack: false, vault: false };

test("seven places on fixed spots (decision 86): Launch · Spot · Earn, Agents in the middle, Arena · Guard · Money", () => {
  assert.deepEqual(PLACES, ["launch", "spot", "earn", "agents", "arena", "guard", "money"]);
  assert.equal(PLACES.length, 7);
  assert.equal(CENTER, "agents");
  assert.equal(PLACES.indexOf(CENTER), LEFT.length);
  assert.equal(LEFT.length, RIGHT.length);
});

test("no Exchange, no Predict, no City, no Studio and no islands among the places or the doors", () => {
  const doors = Object.values(TRAYS).flat();
  for (const gone of ["predict", "exchange", "trade", "city", "studio", "islands", "run", "quarter"]) {
    assert.ok(!PLACES.includes(gone), gone);
    assert.ok(!doors.includes(gone), gone);
  }
});

test("the trays: Spot — Swap · Spot · Futures; Agents — Hangar · Bots; Arena — Ring · Hack · Vault", () => {
  assert.deepEqual(TRAYS, { spot: ["swap", "spot", "futures"], agents: ["hangar", "bots", "garage"], arena: ["ring", "hack", "vault"] });
  for (const place of PLACES) assert.equal(isTray(place), place in TRAYS, place);
});

test("a place of its own whose switch is shut stays on its spot; a tray is open when any of its doors is", () => {
  for (const place of ["launch", "earn", "guard", "money"]) {
    assert.equal(placeOpen(place, ALL_SHUT), false, place);
    assert.equal(placeOpen(place, { ...ALL_SHUT, [place]: true }), true, place);
  }
  assert.equal(placeOpen("spot", ALL_SHUT), false);
  assert.equal(placeOpen("spot", { ...ALL_SHUT, futures: "rxn" }), true);
  assert.equal(placeOpen("agents", { ...ALL_SHUT, bots: true }), true);
  assert.equal(placeOpen("agents", { ...ALL_SHUT, garage: true }), true, "the garage agent alone opens the Agents tray");
  assert.equal(placeOpen("arena", { ...ALL_SHUT, vault: true }), true);
  assert.equal(placeOpen("arena", ALL_SHUT), false);
});

test("Swap rides on trading, Spot needs its own switch too, and the rest each stand on theirs", () => {
  const on = { ...ALL_SHUT, trade: true };
  assert.equal(doorOpen("swap", on), true);
  assert.equal(doorOpen("spot", on), false);
  assert.equal(doorOpen("spot", { ...on, spot: true }), true);
  assert.equal(doorOpen("spot", { ...ALL_SHUT, spot: true }), false);
  for (const door of ["hangar", "bots", "garage", "ring", "hack", "vault"]) {
    assert.equal(doorOpen(door, ALL_SHUT), false, door);
    assert.equal(doorOpen(door, { ...ALL_SHUT, [door]: true }), true, door);
  }
});

test("Futures: Phoenix first while the wallet holds something there, then RXN once live, else no door at all", () => {
  // Closing out: positions or collateral on Phoenix keep the way to close and withdraw, RXN live or not.
  assert.equal(futuresWay("exit", false, true), "exchange");
  assert.equal(futuresWay("exit", true, true), "exchange");
  // Nothing held: RXN when it is live; before that, no door and no link.
  assert.equal(futuresWay("exit", true, false), "rxn");
  assert.equal(futuresWay("exit", false, false), null);
  assert.equal(futuresWay("closed", false, false), null);
  assert.equal(futuresWay("closed", true, true), "rxn");
  // The whole Exchange only while its switch still says `open`.
  assert.equal(futuresWay("open", false, false), "exchange");
  assert.equal(futuresWay("open", true, false), "rxn");
  assert.deepEqual(doorsOf("spot", { ...ALL_SHUT, trade: true, spot: true }), ["swap", "spot"]);
  assert.deepEqual(doorsOf("spot", { ...ALL_SHUT, trade: true }), ["swap"]);
  assert.deepEqual(doorsOf("spot", { ...ALL_SHUT, trade: true, spot: true, futures: "rxn" }), ["swap", "spot", "futures"]);
  // «Обмін» (30.10): Swap · Spot — the bridge is Money's Send to another network (CITY-155); futures are off.
  assert.equal(futuresWay("exit", false, false), null);
  // CITY-188: a door not open yet is not shown — no row of «Soon»; a tray with none open is a shut place.
  assert.deepEqual(doorsOf("arena", ALL_SHUT), []);
  assert.deepEqual(doorsOf("agents", { ...ALL_SHUT, bots: true }), ["bots"]);
  assert.deepEqual(doorsOf("spot", { ...ALL_SHUT, futures: "rxn" }), ["futures"]);
});

test("every place and door has its words in English and Ukrainian", () => {
  for (const lang of ["en", "uk"]) {
    const w = DECK[lang];
    for (const key of [...PLACES, "swap", "spotDoor", "futures", "hangar", "bots", "garage", "hintGarage", "ring", "hack", "vault", "soon", "futuresOnRxn"]) {
      assert.equal(typeof w[key], "string", `${lang}.${key}`);
      assert.ok(w[key].length > 0, `${lang}.${key}`);
    }
  }
  assert.equal(DECK.uk.agents, "Агенти");
  assert.equal(DECK.uk.guard, "Охорона");
  assert.equal(DECK.uk.earn, "Заробіток");
});

test("the top bar and the Deck: hidden by their arrows, kept on this device, broken reads as shown", () => {
  assert.equal(CHROME_KEY, "ryntra.city.chrome.v1");
  assert.deepEqual(readChrome(null), SHOWN);
  assert.deepEqual(readChrome("{oops"), SHOWN);
  assert.deepEqual(readChrome("[1]"), SHOWN);
  assert.deepEqual(readChrome('{"bottom":false}'), { top: true, bottom: false });
  assert.deepEqual(readChrome('{"top":false,"bottom":false}'), { top: false, bottom: false });
  assert.equal(writeChrome(SHOWN), null);
  assert.deepEqual(readChrome(writeChrome({ top: false, bottom: true })), { top: false, bottom: true });
});
