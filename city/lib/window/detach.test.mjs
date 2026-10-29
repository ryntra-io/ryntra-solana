import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cameFromCity,
  chooseVia,
  cleanParams,
  DETACH_KEY,
  detachUrl,
  EMPTY_OUT,
  fitSize,
  OUT_MIN,
  outSize,
  parseDetachUrl,
  parseMessage,
  parseOutMemory,
  popupFeatures,
  readOutMemory,
  rememberOut,
  serializeOutMemory,
  wasOut,
  writeOutMemory,
} from "./detach.ts";

// The rules of a window going out onto another screen (CITY-75), with no browser in them.

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DESK = { desk: true, app: false, pip: true, pipBusy: false, popup: true };

test("how a window goes out: Picture-in-Picture first, a browser window when it is taken or missing, never on a phone or in the app", () => {
  assert.equal(chooseVia(DESK), "pip");
  assert.equal(chooseVia({ ...DESK, pipBusy: true }), "tab", "one Picture-in-Picture per page: the second window goes the other way");
  assert.equal(chooseVia({ ...DESK, pip: false }), "tab", "Firefox and Safari");
  assert.equal(chooseVia({ ...DESK, desk: false }), null, "a phone has no second screen");
  assert.equal(chooseVia({ ...DESK, app: true }), null, "nor the Ryntra app");
  assert.equal(chooseVia({ ...DESK, pip: false, popup: false }), null);
});

test("the route of a window on its own carries its id and plain parameters, and reads back the same", () => {
  const url = detachUrl("chart", { tower: MINT });
  assert.equal(url, `/window?id=chart&tower=${MINT}`);
  assert.deepEqual(parseDetachUrl(url.slice(url.indexOf("?")), ["chart", "exchange"]), { id: "chart", params: { tower: MINT } });
  assert.deepEqual(parseDetachUrl("?id=exchange&symbol=SOL-PERP", ["chart", "exchange"]), { id: "exchange", params: { symbol: "SOL-PERP" } });
  assert.equal(parseDetachUrl("?id=money", ["chart", "exchange"]), null, "only the windows that can live on their own");
  assert.equal(parseDetachUrl("?tower=x", ["chart"]), null);
  assert.throws(() => detachUrl("../x", {}));
});

test("parameters are plain: no script, no path, no long values, no more than four, never the id", () => {
  assert.deepEqual(cleanParams({ tower: MINT, bad: "<script>", path: "../../etc", id: "money", long: "x".repeat(65), n: 4 }), { tower: MINT });
  assert.deepEqual(Object.keys(cleanParams({ a: "1", b: "2", c: "3", d: "4", e: "5" })), ["a", "b", "c", "d"]);
  assert.deepEqual(cleanParams(null), {});
  assert.deepEqual(cleanParams(["a"]), {});
});

test("a window out there fits the screen: never under the least, never over the screen", () => {
  assert.deepEqual(fitSize({ width: 100, height: 100 }, { width: 1920, height: 1080 }), OUT_MIN);
  assert.deepEqual(fitSize({ width: 3000, height: 2000 }, { width: 1920, height: 1080 }), { width: 1920, height: 1080 });
  assert.deepEqual(fitSize({ width: 720.4, height: 560.6 }, { width: 1920, height: 1080 }), { width: 720, height: 561 });
  const features = popupFeatures({ width: 720, height: 560 }, { left: 1920, top: 0, width: 1920, height: 1080 });
  assert.match(features, /^popup=yes,width=720,height=560,left=3096,top=173$/, "at the right of the screen it opens on");
});

test("the memory: what is out and every window's size out there; returned windows keep their size", () => {
  let memory = rememberOut(EMPTY_OUT, "chart", true, { width: 800, height: 600 });
  memory = rememberOut(memory, "exchange", true, { width: 900, height: 700 });
  assert.deepEqual(memory.out, ["chart", "exchange"]);
  assert.ok(wasOut(memory, "chart"));
  memory = rememberOut(memory, "chart", false, { width: 820, height: 610 });
  assert.equal(wasOut(memory, "chart"), false);
  assert.deepEqual(outSize(memory, "chart"), { width: 820, height: 610 });
  assert.deepEqual(parseOutMemory(serializeOutMemory(memory)), memory);
});

test("the memory is not trusted: anything that is not it is the empty memory, a bad entry is dropped", () => {
  for (const raw of [null, "", "{", "[]", '{"v":2,"out":[],"sizes":{}}', '{"v":1,"out":"chart","sizes":{}}', "x".repeat(5000)]) {
    assert.deepEqual(parseOutMemory(raw), EMPTY_OUT, String(raw).slice(0, 20));
  }
  const parsed = parseOutMemory(JSON.stringify({ v: 1, out: ["chart", "../x", 4, "chart"], sizes: { chart: { width: 700, height: 500 }, bad: { width: -1, height: 2 }, "<s>": { width: 1, height: 1 } } }));
  assert.deepEqual(parsed, { out: ["chart"], sizes: { chart: { width: 700, height: 500 } } });
});

test("storage that is missing or refuses: nothing remembered, nothing thrown", () => {
  const refusing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.deepEqual(readOutMemory(() => refusing), EMPTY_OUT);
  assert.doesNotThrow(() => writeOutMemory(() => refusing, EMPTY_OUT));
  assert.deepEqual(readOutMemory(() => null), EMPTY_OUT);
  const items = new Map();
  const working = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
  writeOutMemory(() => working, rememberOut(EMPTY_OUT, "chart", true, { width: 700, height: 500 }));
  assert.ok(items.has(DETACH_KEY));
  assert.ok(wasOut(readOutMemory(() => working), "chart"));
});

test("the channel's messages: only the five, with plain ids, parameters and sizes", () => {
  assert.deepEqual(parseMessage({ t: "hello" }), { t: "hello" });
  assert.deepEqual(parseMessage({ t: "here", id: "chart", params: { tower: MINT, x: "<b>" } }), { t: "here", id: "chart", params: { tower: MINT } });
  assert.deepEqual(parseMessage({ t: "gone", id: "chart", size: { width: 700.2, height: 500 } }), { t: "gone", id: "chart", size: { width: 700, height: 500 } });
  assert.deepEqual(parseMessage({ t: "gone", id: "chart", size: "big" }), { t: "gone", id: "chart", size: null });
  assert.deepEqual(parseMessage({ t: "return", id: "exchange" }), { t: "return", id: "exchange" });
  assert.deepEqual(parseMessage({ t: "follow", id: "chart", params: { tower: MINT } }), { t: "follow", id: "chart", params: { tower: MINT } });
  for (const bad of [null, "hello", { t: "sign", id: "chart" }, { t: "return" }, { t: "return", id: "a b" }]) assert.equal(parseMessage(bad), null);
});

test("a chart's route without its tower is not a window", () => {
  assert.equal(parseDetachUrl("?id=chart", ["chart", "exchange"]), null);
  assert.equal(parseDetachUrl("?id=chart&tower=%3Cscript%3E", ["chart"]), null, "a tower that is not plain is no tower");
});

test("only the city opens a window on its own page: a typed address or another site's link goes to the city", () => {
  const origin = "https://ryntra.io";
  assert.equal(cameFromCity({ openerOrigin: origin, origin, marked: false }), true, "the city opened it");
  assert.equal(cameFromCity({ openerOrigin: null, origin, marked: true }), true, "its own reload stays the window");
  assert.equal(cameFromCity({ openerOrigin: null, origin, marked: false }), false, "a typed address, a bookmark, a link with noopener");
  assert.equal(cameFromCity({ openerOrigin: "https://evil.example", origin, marked: false }), false, "another site's window.open");
});
