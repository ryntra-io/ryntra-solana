// Run from repo root: node --test lib/predictions/workspace.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { MARKET_PANELS, decodeSharedLayout, encodeSharedLayout, mirrorDock, readyDock } from "./market-layout.ts";
import {
  DEFAULT_PREFS,
  alignDates,
  clampPrefs,
  hasNewer,
  mergePrefs,
  sideChosenAt,
  PREFS_COOKIE,
  arrangeCategories,
  changePrefs,
  cleanAmount,
  encodePrefsCookie,
  isLayoutPage,
  layoutPage,
  moveCategory,
  newerPrefs,
  parsePrefs,
  prefsFromCookie,
  storableLayout,
} from "./preferences.ts";
import { readProfile, saveProfile } from "./profile.ts";
import { chanceMeaning, chanceText, moveText } from "./units.ts";

const ALL = MARKET_PANELS.map((panel) => panel.id);

test("a profile is rebuilt field by field: unknown values fall back, extra fields are left behind", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs({ v: 2, units: "odds" }), DEFAULT_PREFS);
  const parsed = parsePrefs({ v: 1, units: "odds", amountUsd: 25.4, side: "left", menu: "icons", density: "compact", slot: 3, hub: { columns: 3, order: ["sports", "<b>", "sports", "crypto"], hidden: ["memes"] }, updatedAt: 5, secret: "x" });
  assert.equal(parsed.units, "odds");
  assert.equal(parsed.amountUsd, 25);
  assert.equal(parsed.side, "left");
  assert.equal(parsed.menu, "icons");
  assert.equal(parsed.density, "compact");
  assert.equal(parsed.slot, 3);
  assert.deepEqual(parsed.hub, { columns: 3, order: ["sports", "crypto"], hidden: ["memes"] });
  assert.equal("secret" in parsed, false);
  assert.equal(parsePrefs({ v: 1, units: "casino", amountUsd: 0, slot: 4, hub: { columns: 7 } }).units, "percent");
  assert.equal(parsePrefs({ v: 1, amountUsd: 0 }).amountUsd, 10);
  assert.equal(parsePrefs({ v: 1, amountUsd: 1e9 }).amountUsd, 10);
  assert.equal(parsePrefs({ v: 1, hub: { columns: 7 } }).hub.columns, 4);
});

test("the amount is a whole number of dollars within bounds", () => {
  assert.equal(cleanAmount("12"), 12);
  assert.equal(cleanAmount(" 7.6 "), 8);
  assert.equal(cleanAmount("abc"), null);
  assert.equal(cleanAmount(0), null);
  assert.equal(cleanAmount(100_001), null);
});

test("of two copies the later change wins, the first on a tie; a change is dated", () => {
  const a = { ...DEFAULT_PREFS, units: "odds", updatedAt: 10 };
  const b = { ...DEFAULT_PREFS, units: "cents", updatedAt: 20 };
  assert.equal(newerPrefs(a, b), b);
  assert.equal(newerPrefs(b, a), b);
  assert.equal(newerPrefs(a, { ...b, updatedAt: 10 }), a);
  assert.equal(newerPrefs(null, a), a);
  const changed = changePrefs(DEFAULT_PREFS, { units: "percent", hub: { columns: 2 } }, 99);
  assert.equal(changed.units, "percent");
  assert.equal(changed.hub.columns, 2);
  assert.deepEqual(changed.hub.order, []);
  assert.equal(changed.updatedAt, 99);
});

test("the cookie copy reads back the same profile; a broken cookie reads as none", () => {
  const prefs = changePrefs(DEFAULT_PREFS, { density: "compact", hub: { order: ["politics"] } }, 7);
  const header = `a=1; ${PREFS_COOKIE}=${encodePrefsCookie(prefs)}; b=2`;
  assert.deepEqual(prefsFromCookie(header), prefs);
  assert.equal(prefsFromCookie(`${PREFS_COOKIE}=%7Bnot-json`), null);
  assert.equal(prefsFromCookie("other=1"), null);
  assert.ok(encodePrefsCookie(prefs).length < 1024);
});

test("the hub's categories: the person's order first, the rest in the provider's, the put-away left out", () => {
  const cats = ["politics", "sports", "crypto", "economy"].map((slug) => ({ slug }));
  const hub = { columns: 4, order: ["economy", "sports"], hidden: ["crypto"] };
  assert.deepEqual(arrangeCategories(cats, hub).map((c) => c.slug), ["economy", "sports", "politics"]);
  assert.deepEqual(arrangeCategories(cats, DEFAULT_PREFS.hub).map((c) => c.slug), ["politics", "sports", "crypto", "economy"]);
  assert.deepEqual(moveCategory(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveCategory(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveCategory(["a", "b", "c"], "x", 1), ["a", "b", "c"]);
});

test("units: one price said four ways, nothing added", () => {
  assert.equal(chanceText(0.62, "percent", 10), "62%");
  assert.equal(chanceText(0.045, "percent", 10), "4.5%");
  assert.equal(chanceText(0.62, "cents", 10), "62¢");
  assert.equal(chanceText(0.5, "odds", 10), "2.00");
  assert.equal(chanceText(0.62, "payout", 10), "$10 → ≈$16.13");
  assert.equal(chanceText(0.25, "payout", 50), "$50 → ≈$200.00");
  assert.equal(chanceText(null, "payout", 10), "—");
  assert.equal(chanceText(0, "odds", 10), "—");
  assert.equal(chanceText(1.2, "percent", 10), "—");
  assert.match(chanceMeaning(0.62, "payout", 10, "uk"), /^Купуєш на \$10 — отримаєш ≈ \$16\.13, до комісій$/);
  assert.match(chanceMeaning(0.5, "odds", 10, "en"), /\$1 returns \$2\.00/);
  assert.equal(moveText(0.031, "cents"), "+3.1¢");
  assert.equal(moveText(-0.02, "percent"), "−2.0 pp");
  assert.equal(moveText(null, "odds"), "—");
});

/** The panels of a leaf, in order, walking the grid left to right. */
function leaves(node, out = []) {
  if (node.type === "leaf") out.push(node.data.views);
  else for (const child of node.data) leaves(child, out);
  return out;
}

test("the ready «Стандарт» of before: the chart and the tabs beside the ticket, the ticket on the chosen side with Ryntra under it", () => {
  const right = readyDock("standard", ALL, "right");
  assert.equal(right.grid.orientation, "HORIZONTAL");
  assert.deepEqual(leaves(right.grid.root), [["chart"], ["outcomes", "rules", "map", "book", "prices", "news"], ["ticket"], ["ryntra"]]);
  // The ticket first in its column, the larger share of it.
  const column = right.grid.root.data[1];
  assert.deepEqual(column.data.map((leaf) => leaf.data.views[0]), ["ticket", "ryntra"]);
  assert.equal(column.data[0].size > column.data[1].size, true);
  assert.deepEqual(right.panels.ryntra, { id: "ryntra", contentComponent: "block", params: { id: "ryntra" } });
  assert.deepEqual(Object.keys(right.panels).sort(), [...ALL].sort());
  assert.deepEqual(right.panels.ticket, { id: "ticket", contentComponent: "block", params: { id: "ticket", kind: "ticket" } });
  assert.equal(right.activeGroup, "g-chart");
  const sizes = right.grid.root.data.map((column) => column.size);
  assert.equal(sizes[0] > sizes[1], true);

  const left = readyDock("standard", ALL, "left");
  assert.deepEqual(leaves(left.grid.root), [["ticket"], ["ryntra"], ["chart"], ["outcomes", "rules", "map", "book", "prices", "news"]]);
  assert.deepEqual(left.grid.root.data.map((column) => column.size), [...sizes].reverse());
});

test("a ready layout without some panels: emptied groups go, a column of one group stands as that group", () => {
  const noBook = readyDock("standard", ["chart", "ticket", "rules"], "right");
  assert.deepEqual(leaves(noBook.grid.root), [["chart"], ["rules"], ["ticket"]]);
  assert.equal(noBook.grid.root.data[1].type, "leaf");
  const onlyLeft = readyDock("standard", ["outcomes", "ticket"], "right");
  assert.equal(onlyLeft.grid.root.data[0].type, "leaf");
  assert.deepEqual(leaves(onlyLeft.grid.root), [["outcomes"], ["ticket"]]);
  assert.equal(noBook.panels.book, undefined);

  const chartOnly = readyDock("standard", ["chart", "outcomes"], "left");
  assert.equal(chartOnly.grid.orientation, "VERTICAL");
  assert.deepEqual(leaves(chartOnly.grid.root), [["chart"], ["outcomes"]]);

  assert.equal(readyDock("standard", [], "right"), undefined);
  assert.deepEqual(leaves(readyDock("standard", ["ticket"], "right").grid.root), [["ticket"]]);
});

test("mirroring twice gives the arrangement back; a person's own split mirrors too", () => {
  const dock = readyDock("standard", ALL, "right");
  assert.deepEqual(mirrorDock(mirrorDock(dock)), dock);
  // The ticket dragged into the chart's column, beside the chart: that inner split is side by side too.
  const own = {
    grid: {
      orientation: "VERTICAL",
      width: 1000,
      height: 800,
      root: { type: "branch", size: 1000, data: [{ type: "branch", size: 500, data: [{ type: "leaf", size: 700, data: { id: "a", views: ["chart"] } }, { type: "leaf", size: 300, data: { id: "b", views: ["ticket"] } }] }, { type: "leaf", size: 300, data: { id: "c", views: ["book"] } }] },
    },
    panels: {},
  };
  const mirrored = mirrorDock(own);
  assert.deepEqual(leaves(mirrored.grid.root), [["ticket"], ["chart"], ["book"]]);
  assert.equal(mirrorDock(undefined), undefined);
});

test("a layout in a link: the shape goes, the dates and the step back stay home; anything else reads as none", () => {
  const layout = { v: 1, preset: "dense", blocks: [{ id: "chart", span: 8, hidden: false }], updatedAt: 123, dock: readyDock("standard", ["chart"], "right"), before: { v: 1 } };
  const code = encodeSharedLayout(layout);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeSharedLayout(code);
  assert.equal(back.updatedAt, 0);
  assert.equal(back.before, undefined);
  assert.deepEqual(back.dock, layout.dock);
  assert.equal(decodeSharedLayout("not base64!"), null);
  assert.equal(decodeSharedLayout(Buffer.from(JSON.stringify({ v: 2 })).toString("base64url")), null);
  assert.equal(decodeSharedLayout(""), null);
});

test("layout pages and what the account keeps", () => {
  assert.equal(layoutPage(2), "predict-market-2");
  assert.equal(isLayoutPage("predict-market-2"), true);
  assert.equal(isLayoutPage("../etc"), false);
  assert.equal(storableLayout({ v: 1, blocks: [], updatedAt: 1 }).v, 1);
  assert.equal(storableLayout({ v: 1, blocks: [], updatedAt: -1 }), null);
  assert.equal(storableLayout({ v: 1, blocks: "x", updatedAt: 1 }), null);
  assert.equal(storableLayout({ v: 1, blocks: [], updatedAt: 1, pad: "x".repeat(30_000) }).pad, undefined);
  assert.equal(storableLayout({ v: 1, blocks: [], updatedAt: 1, dock: { grid: { pad: "x".repeat(30_000) } } }), null);
  assert.equal(storableLayout({ v: 1, blocks: new Array(40).fill({}), updatedAt: 1 }), null);
});

test("the account's profile: later settings win, each page's layout on its own, a slow older write changes nothing", async () => {
  const store = createMemoryGuardStore();
  const wallet = "0xabc";
  assert.deepEqual((await readProfile(store, wallet)).value, { prefs: null, layouts: {} });

  const first = await saveProfile(store, wallet, { prefs: { ...DEFAULT_PREFS, units: "odds", updatedAt: 20 } });
  assert.equal(first.ok && first.value.prefs.units, "odds");
  const older = await saveProfile(store, wallet, { prefs: { ...DEFAULT_PREFS, units: "cents", updatedAt: 10 } });
  assert.equal(older.ok && older.value.prefs.units, "odds");

  const one = { v: 1, preset: "dense", blocks: [], updatedAt: 50 };
  await saveProfile(store, wallet, { layout: { page: "predict-market-1", value: one } });
  await saveProfile(store, wallet, { layout: { page: "predict-market-2", value: { ...one, updatedAt: 60 } } });
  const stale = await saveProfile(store, wallet, { layout: { page: "predict-market-1", value: { ...one, updatedAt: 40, preset: "calm" } } });
  assert.equal(stale.ok && stale.value.layouts["predict-market-1"].preset, "dense");
  const after = (await readProfile(store, wallet)).value;
  assert.deepEqual(Object.keys(after.layouts).sort(), ["predict-market-1", "predict-market-2"]);
  assert.equal(after.prefs.units, "odds");

  // Another wallet sees nothing of it; the watchlist's own record is untouched.
  assert.deepEqual((await readProfile(store, "0xdef")).value, { prefs: null, layouts: {} });
  const { readWatchlist } = await import("./watchlist.ts");
  assert.deepEqual(await readWatchlist(store, wallet), []);
});

test("the account keeps a bounded number of pages, the oldest going first", async () => {
  const store = createMemoryGuardStore();
  for (let i = 1; i <= 10; i += 1) await saveProfile(store, "w", { layout: { page: `predict-p-${i}`, value: { v: 1, blocks: [], updatedAt: i } } });
  const { layouts } = (await readProfile(store, "w")).value;
  assert.equal(Object.keys(layouts).length, 8);
  assert.equal(layouts["predict-p-1"], undefined);
  assert.equal(layouts["predict-p-10"].updatedAt, 10);
});

test("two devices keep each other's choices: merged choice by choice, the later change of one choice winning", () => {
  const phone = changePrefs(DEFAULT_PREFS, { units: "cents" }, 100);
  const desk = changePrefs(changePrefs(DEFAULT_PREFS, { density: "compact" }, 50), { slot: 2 }, 200);
  const merged = mergePrefs(desk, phone);
  assert.equal(merged.units, "cents");
  assert.equal(merged.density, "compact");
  assert.equal(merged.slot, 2);
  assert.equal(merged.updatedAt, 200);
  assert.deepEqual(mergePrefs(phone, desk), merged);
  // The later change of one choice wins; the merge of a copy with itself is itself.
  const later = changePrefs(phone, { units: "odds" }, 300);
  assert.equal(mergePrefs(later, phone).units, "odds");
  assert.equal(mergePrefs(phone, later).units, "odds");
  assert.equal(mergePrefs(desk, desk), desk);
  assert.equal(hasNewer(desk, phone), true);
  assert.equal(hasNewer(merged, phone), false);
  // The hub's choices are separate: the order on one device, the columns on another.
  const a = changePrefs(DEFAULT_PREFS, { hub: { ...DEFAULT_PREFS.hub, order: ["crypto"] } }, 10);
  const b = changePrefs(DEFAULT_PREFS, { hub: { ...DEFAULT_PREFS.hub, columns: 2 } }, 20);
  assert.deepEqual(mergePrefs(a, b).hub, { columns: 2, order: ["crypto"], hidden: [] });
  // A copy from before the choices were dated counts as made at its own date.
  const old = parsePrefs({ v: 1, units: "percent", updatedAt: 150 });
  assert.equal(mergePrefs(phone, old).units, "percent");
  assert.equal(sideChosenAt(changePrefs(DEFAULT_PREFS, { side: "left" }, 77)), 77);
  assert.equal(sideChosenAt(DEFAULT_PREFS), 0);
});

test("a clock ahead does not win by being ahead", () => {
  const ahead = changePrefs(DEFAULT_PREFS, { units: "odds" }, 10_000);
  const clamped = clampPrefs(ahead, 5_000);
  assert.equal(clamped.updatedAt, 5_000);
  assert.equal(clamped.at.units, 5_000);
});

test("the account clamps a date from the future to its own clock", async () => {
  const store = createMemoryGuardStore();
  const now = 1_000_000;
  const saved = await saveProfile(store, "w", { prefs: changePrefs(DEFAULT_PREFS, { units: "odds" }, now * 10), layout: { page: "predict-market-1", value: { v: 1, blocks: [], updatedAt: now * 10 } } }, now);
  assert.equal(saved.ok && saved.value.prefs.updatedAt <= now + 60_000, true);
  assert.equal(saved.ok && saved.value.layouts["predict-market-1"].updatedAt, now + 60_000);
  const second = await saveProfile(store, "w", { prefs: changePrefs(DEFAULT_PREFS, { units: "cents" }, now + 120_000) }, now + 120_000);
  assert.equal(second.ok && second.value.prefs.units, "cents");
});

test("a store that cannot answer is said plainly, not thrown", async () => {
  const broken = { versioned: () => ({ get: async () => { throw new Error("ECONNRESET"); } }) };
  const read = await readProfile(broken, "w");
  assert.equal(read.ok, false);
  assert.equal(read.code, "UNAVAILABLE");
});

test("a device ahead takes the account's dates for the choices both hold alike", () => {
  const ahead = changePrefs(changePrefs(DEFAULT_PREFS, { units: "odds" }, 9_000), { density: "compact" }, 9_500);
  const account = clampPrefs(ahead, 5_000);
  const aligned = alignDates(ahead, account);
  assert.equal(aligned.at.units, 5_000);
  assert.equal(aligned.at.density, 5_000);
  assert.equal(hasNewer(account, aligned), false);
  // A choice that differs keeps its own date; nothing to align is the same copy.
  const other = changePrefs(account, { units: "cents" }, 6_000);
  assert.equal(alignDates(ahead, other).at.units, 9_000);
  assert.equal(alignDates(account, account), account);
});
