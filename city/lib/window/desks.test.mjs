import { test } from "node:test";
import assert from "node:assert/strict";

import { areaOf, bayRect } from "./geometry.ts";
import { emptyLayout, firstPlace, openIn, placed, popOutIn, tabIn } from "./layout.ts";
import * as DESKS from "./desks.ts";
import {
  DESKS_KEY,
  desksOf,
  GUEST,
  keepShot,
  NO_DESKS,
  OWNER_LIMIT,
  ownerOf,
  parseDesks,
  parseShot,
  PRESET_WINDOWS,
  PRESETS,
  presetPlan,
  presetReady,
  readDesks,
  serializeDesks,
  shotOf,
  shotPlan,
  withDesks,
  writeDesks,
} from "./desks.ts";

// The layouts of CITY-84: Ryntra's four presets and the person's four, kept on the device per wallet.

const DESK = { width: 1440, height: 900 };
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const open = (layout, id) => openIn(layout, { id }, firstPlace(layout));

test("Ryntra's four presets: Trader, Futures, Predictions, Money — each window in a bay", () => {
  assert.deepEqual([...PRESETS], ["trader", "futures", "predict", "money"]);
  for (const preset of PRESETS) {
    assert.ok(PRESET_WINDOWS[preset].length >= 1);
    for (const w of PRESET_WINDOWS[preset]) assert.ok(w.bay === "left" || w.bay === "right", `${preset}: ${w.id}`);
    // No preset puts two windows in one bay: the city keeps its middle.
    const bays = PRESET_WINDOWS[preset].map((w) => w.bay);
    assert.equal(new Set(bays).size, bays.length, preset);
  }
  // Predictions stand beside the futures (helm §3).
  assert.deepEqual(PRESET_WINDOWS.predict.map((w) => w.id).sort(), ["exchange", "predict"]);
});

test("a preset is offered only where the windows it cannot do without can open; the rest are left out of it", () => {
  const all = () => true;
  const none = () => false;
  for (const preset of PRESETS) assert.ok(presetReady(preset, all), preset);
  for (const preset of PRESETS) assert.ok(!presetReady(preset, none), preset);
  // Futures shut: the Futures preset is not offered; Predictions are, without the futures beside them.
  const noFutures = (id) => id !== "exchange";
  assert.ok(!presetReady("futures", noFutures));
  assert.ok(presetReady("predict", noFutures));
  const area = areaOf(DESK);
  const plan = presetPlan("predict", area, noFutures);
  assert.deepEqual(plan.map((p) => p.id), ["predict"]);
  assert.deepEqual(plan[0].recall, { rect: bayRect(area, "right"), full: false, bay: "right" });
});

test("a layout of the person's is the windows on the screen: bays, places, tabs and what each shows", () => {
  let layout = open(open(emptyLayout(DESK), "spot"), "money");
  layout = popOutIn(open(layout, "chart"), "chart");
  // A frame dragged onto another brings every tab it has: the Exchange first floats on its own, then joins the chart.
  layout = tabIn(popOutIn(open(layout, "exchange"), "exchange"), "exchange", "chart");
  const params = { chart: { tower: "So11111111111111111111111111111111111111112" }, exchange: { symbol: "SOL-PERP" } };
  const shot = shotOf(layout, (id) => params[id]);
  assert.deepEqual(shot.windows.map((w) => w.id).sort(), ["chart", "exchange", "money", "spot"]);
  const by = Object.fromEntries(shot.windows.map((w) => [w.id, w]));
  assert.equal(by.spot.bay, "right");
  assert.equal(by.money.bay, "left");
  assert.equal(by.chart.bay, null);
  assert.equal(by.chart.tab, by.exchange.tab);
  assert.notEqual(by.chart.tab, by.spot.tab);
  assert.deepEqual(by.chart.params, params.chart);
  assert.equal(by.money.params, undefined);
  assert.equal(shotOf(emptyLayout(DESK), () => undefined), null);

  // Put back on a smaller screen: the bays where they were, a floating frame at its size, its second window its tab.
  const small = areaOf({ width: 1280, height: 800 });
  const plan = shotPlan(shot, small);
  const p = Object.fromEntries(plan.map((x) => [x.id, x]));
  assert.equal(p.money.recall.bay, "left");
  assert.equal(p.spot.recall.bay, "right");
  assert.equal(p.chart.recall.bay, null);
  const [first, second] = [p.chart, p.exchange].sort((a, b) => plan.indexOf(a) - plan.indexOf(b));
  assert.equal(first.recall.tab, null);
  assert.equal(second.recall.tab, first.id);
  assert.equal(p.chart.recall.rect.width, by.chart.rect.width);
  assert.deepEqual(p.exchange.params, params.exchange);
  // Opened in that order, the windows stand as they stood.
  const again = plan.reduce((l, x) => openIn(l, { id: x.id }, x.recall), emptyLayout({ width: 1280, height: 800 }));
  assert.equal(placed(again, "exchange").stack, placed(again, "chart").stack);
  assert.equal(placed(again, "money").bay, "left");
});

test("kept per wallet on this device: each wallet its own four, a guest's before one connects, the oldest wallets go first", () => {
  const shot = shotOf(open(emptyLayout(DESK), "spot"), () => undefined);
  let memory = parseDesks(null);
  assert.deepEqual(desksOf(memory, WALLET), NO_DESKS);
  memory = withDesks(memory, WALLET, { ...keepShot(desksOf(memory, WALLET), 1, shot), active: 1 });
  memory = withDesks(memory, GUEST, { ...desksOf(memory, GUEST), active: "money" });
  const back = parseDesks(serializeDesks(memory));
  assert.deepEqual(desksOf(back, WALLET).slots[1], shot);
  assert.equal(desksOf(back, WALLET).active, 1);
  assert.equal(desksOf(back, WALLET).slots[0], null);
  assert.equal(desksOf(back, GUEST).active, "money");
  assert.deepEqual(desksOf(back, OTHER), NO_DESKS, "another wallet sees none of them");
  // Only so many wallets are kept: the one used longest ago goes.
  let many = back;
  for (let i = 0; i < OWNER_LIMIT + 2; i += 1) many = withDesks(many, `${"1".repeat(31)}${String.fromCharCode(65 + i)}`, NO_DESKS);
  assert.equal(Object.keys(many.owners).length, OWNER_LIMIT);
  assert.ok(!(WALLET in many.owners));
  // The key: a wallet's address, else «guest»; anything that is not an address is a guest.
  assert.equal(ownerOf(WALLET), WALLET);
  assert.equal(ownerOf(null), GUEST);
  assert.equal(ownerOf("../../etc"), GUEST);
  assert.equal(withDesks(back, "<script>", NO_DESKS), back);
});

test("what is not a kept layout is not trusted: junk, other versions, bad windows, bad owners, too much", () => {
  for (const raw of [null, "", "{", "[]", "null", '{"v":2,"owners":{}}', '{"v":1,"owners":[]}', "x".repeat(60000)]) {
    assert.deepEqual(parseDesks(raw), { owners: {} }, String(raw).slice(0, 30));
  }
  const area = { x: 16, y: 72, width: 1408, height: 724 };
  const parsed = parseDesks(
    JSON.stringify({
      v: 1,
      owners: {
        [WALLET]: {
          active: 7,
          slots: [
            {
              area,
              bays: { left: 400, right: -3, middle: 9 },
              windows: [
                { id: "spot", bay: "right", rect: { x: 992, y: 72, width: 432, height: 724 }, tab: 0, params: { tower: "abc", "<x>": "y", bad: "a b" } },
                { id: "spot", bay: "left", rect: { x: 16, y: 72, width: 432, height: 724 }, tab: 1 },
                { id: "bad id!", bay: null, rect: { x: 0, y: 0, width: 10, height: 10 }, tab: 0 },
                { id: "chart", bay: "middle", rect: { x: 500, y: 100, width: 400, height: 300 }, tab: 2 },
                { id: "neg", bay: null, rect: { x: 0, y: 0, width: -1, height: 10 }, tab: 0 },
                { id: "tabless", bay: null, rect: { x: 0, y: 0, width: 10, height: 10 }, tab: 1.5 },
              ],
            },
            "junk",
            { area, windows: [] },
          ],
        },
        "not a wallet": { slots: [], active: "trader" },
      },
    }),
  );
  assert.deepEqual(Object.keys(parsed.owners), [WALLET]);
  const own = parsed.owners[WALLET];
  assert.equal(own.active, null);
  assert.equal(own.slots.length, 4);
  assert.deepEqual(own.slots[0].windows.map((w) => w.id), ["spot", "chart"]);
  assert.deepEqual(own.slots[0].windows[0].params, { tower: "abc" });
  assert.equal(own.slots[0].windows[1].bay, null);
  assert.deepEqual(own.slots[0].bays, { left: 400 });
  assert.equal(own.slots[1], null);
  assert.equal(own.slots[2], null, "a layout with no windows is no layout");
  assert.equal(parseShot({ area, windows: "x" }), null);
});

test("storage: one key; missing, refusing or broken storage means no layouts kept, never an error", () => {
  const items = new Map();
  const ok = () => ({ getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) });
  const memory = withDesks({ owners: {} }, WALLET, { ...NO_DESKS, active: "trader" });
  writeDesks(ok, memory);
  assert.ok(items.has(DESKS_KEY));
  assert.deepEqual(readDesks(ok), memory);
  const refuse = () => ({
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  for (const bad of [refuse, () => null, () => { throw new Error("no window"); }]) {
    assert.deepEqual(readDesks(bad), { owners: {} });
    assert.doesNotThrow(() => writeDesks(bad, memory));
  }
});

test("the layout in use follows the screen: windows closed for a run or folded stay in it; only the person's own close lets one go", () => {
  const { mergeShot } = DESKS;
  let layout = open(open(emptyLayout(DESK), "spot"), "money");
  layout = open(layout, "chart");
  const before = shotOf(layout, () => undefined);
  // A run closed the chart through its owner; Money and the card stand again after it.
  const after = shotOf(open(open(emptyLayout(DESK), "spot"), "money"), () => undefined);
  const merged = mergeShot(before, after);
  assert.deepEqual(merged.windows.map((w) => w.id).sort(), ["chart", "money", "spot"]);
  // The chart kept its own frame number apart from the windows on the screen.
  const tabs = new Map(merged.windows.map((w) => [w.id, w.tab]));
  assert.ok(![tabs.get("money"), tabs.get("spot")].includes(tabs.get("chart")));
  // The person closed the chart themselves: it goes.
  assert.deepEqual(mergeShot(before, after, new Set(["chart"])).windows.map((w) => w.id).sort(), ["money", "spot"]);
  // Nothing on the screen: what the layout had stays, unless nothing would be left.
  assert.deepEqual(mergeShot(before, null).windows.map((w) => w.id).sort(), ["chart", "money", "spot"]);
  assert.equal(mergeShot(before, null, new Set(["chart", "money", "spot"])), null);
  assert.equal(mergeShot(null, null), null);
  // A floating window it kept is carried onto the new screen at its size.
  const free = shotOf(popOutIn(open(emptyLayout(DESK), "earn"), "earn"), () => undefined);
  const small = shotOf(open(emptyLayout({ width: 1280, height: 800 }), "spot"), () => undefined);
  const carried = mergeShot(free, small).windows.find((w) => w.id === "earn");
  assert.equal(carried.rect.width, free.windows[0].rect.width);
  assert.ok(carried.rect.x + carried.rect.width <= small.area.x + small.area.width);
});
