import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CITY_GUIDE_FLAGS, GUIDE_ACTION, GUIDE_IDS, GUIDE_NEEDS, guideFlags, isGuideId, lessons, liveGuides, tryHref, tryParam, withoutTry } from "./guides.ts";

/* CITY-43: «How it works» shows a lesson only when its film is here and its function is live on this deployment — open
   to everyone, or behind a switch of the city that is open, read by the city's own rules. No film, no card. */

const ids = (flags) => liveGuides(flags);
const film = (id) => ({ mp4: `/city/how/${id}.mp4`, poster: `/city/how/${id}.webp` });
const filmsOf = (...names) => Object.fromEntries(names.map((id) => [id, film(id)]));

/** Production as it stands on 31.10: trade open (not `closed`), beacons on the device, the agents, spot, money and launch shut. */
const PROD = { agents: undefined, launch: undefined, trade: undefined, spot: undefined, beacons: "device", money: undefined };

test("no film, no lesson: with an empty manifest nothing shows, whatever is live", () => {
  assert.deepEqual(lessons(guideFlags(PROD), {}), []);
  const all = guideFlags({ agents: "open", launch: "open", trade: "open", spot: "open", beacons: "open", money: "open" }, true);
  assert.deepEqual(lessons(all, {}), []);
});

test("a lesson shows when its film is here and its function is live, in the page's order", () => {
  const films = filmsOf("quarter", "city", "trade", "money");
  assert.deepEqual(
    lessons(guideFlags(PROD), films).map((l) => l.id),
    ["trade", "city", "quarter"],
    "money has its film but its switch is shut",
  );
  assert.equal(lessons(guideFlags(PROD), films)[0].film.mp4, "/city/how/trade.mp4");
});

test("a film for a function the page does not know is never shown", () => {
  assert.deepEqual(lessons(guideFlags(PROD), filmsOf("predict", "exchange", "nothing")), []);
});

test("production: what everyone can do, trade and beacons; the shut switches stay out", () => {
  assert.deepEqual(ids(guideFlags(PROD)), ["trade", "city", "search", "chart", "assistant", "quarter", "beacons"]);
});

test("with every switch shut, only what needs none stays", () => {
  const shut = guideFlags({ agents: "closed", launch: "closed", trade: "closed", spot: "closed", beacons: "closed", money: "closed" });
  assert.deepEqual(ids(shut), ["city", "search", "chart", "assistant", "quarter"]);
});

test("the agent and money open only with their switch saying open", () => {
  for (const key of ["agents", "money"]) {
    assert.equal(ids(guideFlags(PROD)).includes(key), false, `${key} shut by default`);
    assert.equal(ids(guideFlags({ ...PROD, [key]: "yes" })).includes(key), false, `${key} shut by anything but open`);
    assert.equal(ids(guideFlags({ ...PROD, [key]: "open" })).includes(key), true, `${key} open with its switch`);
  }
  assert.equal(ids(guideFlags({ ...PROD, agents: "open" }))[0], "agents", "the agent leads (decision 91)");
});

test("limit and stop need both the trade and the spot switch", () => {
  assert.equal(ids(guideFlags({ ...PROD, spot: "open" })).includes("spot"), true);
  assert.equal(ids(guideFlags({ ...PROD, spot: "open", trade: "closed" })).includes("spot"), false);
  assert.equal(ids(guideFlags({ ...PROD, spot: "on" })).includes("spot"), false);
});

test("trade and beacons follow their switches as the city reads them", () => {
  assert.equal(ids(guideFlags({ ...PROD, trade: "closed" })).includes("trade"), false);
  assert.equal(ids(guideFlags({ ...PROD, beacons: undefined })).includes("beacons"), false);
  assert.equal(ids(guideFlags({ ...PROD, beacons: "open" })).includes("beacons"), true);
});

test("launch shows only with its switch open and mainnet allowed for the city", () => {
  assert.equal(ids(guideFlags({ ...PROD, launch: "open" }, false)).includes("launch"), false, "the switch alone is not enough on mainnet");
  assert.equal(ids(guideFlags({ ...PROD, launch: "open" }, true)).includes("launch"), true);
  assert.equal(ids(guideFlags({ ...PROD }, true)).includes("launch"), false);
});

test("prediction markets and futures are RXN's (decision 86): no lesson of the city for them", () => {
  for (const id of ["predict", "exchange", "oracle", "futures"]) assert.equal(isGuideId(id), false, id);
});

test("every function has its switches and its action word", () => {
  assert.deepEqual(Object.keys(GUIDE_NEEDS).sort(), [...GUIDE_IDS].sort());
  assert.deepEqual(Object.keys(GUIDE_ACTION).sort(), [...GUIDE_IDS].sort());
});

test("this build's flags are the city's own constants, read from the same switches", () => {
  const env = (name) => process.env[`NEXT_PUBLIC_RYNTRA_CITY_${name}`];
  assert.deepEqual(
    CITY_GUIDE_FLAGS,
    guideFlags({ agents: env("AGENTS"), launch: env("LAUNCH"), trade: env("TRADE"), spot: env("SPOT"), beacons: env("BEACONS"), money: env("MONEY") }),
  );
  // The constants, not a copy of their rules: the module imports the very switches the menu and the windows read.
  const source = readFileSync(new URL("./guides.ts", import.meta.url), "utf8");
  for (const name of ["AGENTS_OPEN", "TRADE_OPEN", "SPOT_OPEN", "BEACONS", "MONEY_OPEN", "CITY_LAUNCH_SWITCH", "CITY_LAUNCH_MAINNET"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`), name);
  }
});

test("?try= opens only a function that is live here, and leaves the address", () => {
  const flags = guideFlags(PROD);
  assert.equal(tryParam("?try=trade", flags), "trade");
  assert.equal(tryParam("?coin=SOL&try=chart", flags), "chart");
  assert.equal(tryParam("?try=money", flags), null, "a closed function does not open");
  assert.equal(tryParam("?try=nothing", flags), null);
  assert.equal(tryParam("?try=toString", flags), null);
  assert.equal(tryParam("", flags), null);
  assert.equal(tryHref("chart"), "/?try=chart");
  assert.equal(withoutTry("/", "?try=chart", ""), "/");
  assert.equal(withoutTry("/", "?lang=uk&try=chart", "#x"), "/?lang=uk#x");
});
