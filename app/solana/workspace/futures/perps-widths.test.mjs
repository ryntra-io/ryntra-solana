// Run from repo root: node --test app/solana/workspace/futures/perps-widths.test.mjs
//
// PERP-6 — Perps' Simple and Pro, layouts, settings and widths: each width's «Стандарт» and its own page, the move of
// a layout kept under `solana/perps.v2`, the settings with no way to turn a warning off, the positions as cards where
// a table would not stand whole, and the order on a phone's own screen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PERPS_LAYOUT_LEGACY,
  PERPS_LAYOUT_PAGE,
  PERPS_PANELS,
  PERPS_STANDARDS,
  PERPS_WIDTHS,
  perpsLayoutPage,
  perpsLayoutStore,
  perpsNarrowDock,
  perpsStandardDock,
  perpsTabletDock,
  perpsWidthOf,
} from "./perps-layout.ts";
import { CARDS_BELOW, DEFAULT_PERPS_SETTINGS, PERPS_GUARDS, cardsFor, densityOf, largeTargets, parsePerpsSettings } from "./perps-settings.ts";
import { PERPS_WORDS, perpsWord } from "./perps-words.ts";
import { futuresWord } from "./futures-words.ts";

const source = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const views = (node) => (node.type === "leaf" ? [node.data.views] : node.data.flatMap(views));

test("the widths of the spec (§2): a desk from 1200 px, a narrow desk, a tablet under 900 px, a phone under the core's 768", () => {
  assert.deepEqual(PERPS_WIDTHS, ["desk", "narrow", "tablet", "phone"]);
  for (const [width, expected] of [[1920, "desk"], [1440, "desk"], [1200, "desk"], [1199, "narrow"], [1024, "narrow"], [900, "narrow"], [899, "tablet"], [768, "tablet"], [767, "phone"], [390, "phone"], [360, "phone"]]) {
    assert.equal(perpsWidthOf(width), expected, String(width));
  }
});

test("each width keeps its own layout (spec §14) under a new key; the desk's is `solana/perps.v3`", () => {
  assert.equal(PERPS_LAYOUT_PAGE, "solana/perps.v3");
  assert.equal(PERPS_LAYOUT_LEGACY, "solana/perps.v2");
  const pages = PERPS_WIDTHS.map(perpsLayoutPage);
  assert.deepEqual(pages, ["solana/perps.v3", "solana/perps.v3.narrow", "solana/perps.v3.tablet", "solana/perps.v3.phone"]);
  assert.equal(new Set(pages).size, pages.length);
});

test("each width's «Стандарт»: under 1200 px the book is the chart's tab and the ticket keeps its column; a tablet's ticket the whole height", () => {
  /* The desk as PERP-2 laid it out: the book beside the chart. */
  assert.deepEqual(views(perpsStandardDock().grid.root), [["chart"], ["book"], ["positions", "orders", "trades", "funding", "history"], ["ticket"], ["account"]]);
  /* Narrow: the book a tab beside the chart, the account under the ticket. */
  const narrow = perpsNarrowDock();
  assert.deepEqual(views(narrow.grid.root), [["chart", "book"], ["positions", "orders", "trades", "funding", "history"], ["ticket"], ["account"]]);
  /* Tablet: the account among the tables, the ticket alone on the right. */
  const tablet = perpsTabletDock();
  assert.deepEqual(views(tablet.grid.root), [["chart", "book"], ["positions", "orders", "trades", "funding", "history", "account"], ["ticket"]]);
  assert.equal(tablet.grid.root.data[1].type, "leaf");
  /* The ticket's column gives it the spec's 316 px at the narrowest window of each class, the menu beside it. */
  const ticketShare = (dock) => dock.grid.root.data[1].size / dock.grid.root.data.reduce((sum, child) => sum + child.size, 0);
  assert.ok(ticketShare(narrow) * (1024 - 240 - 32) >= 316, "narrow at 1024 with the menu");
  assert.ok(ticketShare(tablet) * (768 - 32) >= 316, "tablet at 768");
  /* The core compares arrangements by shares in fiftieths: no share of any start sits on a half. */
  const halves = (node) => (node.type === "branch" ? [...node.data.map((child) => (child.size / node.data.reduce((sum, item) => sum + item.size, 0)) * 50), ...node.data.flatMap(halves)] : []);
  for (const dock of [perpsStandardDock(), narrow, tablet]) {
    for (const share of halves(dock.grid.root)) assert.ok(Math.abs((share % 1) - 0.5) > 0.1, `a share of ${share.toFixed(2)} fiftieths`);
    for (const id of Object.keys(dock.panels)) assert.ok(PERPS_PANELS.some((spec) => spec.id === id));
  }
  /* A phone has no arrangement: the panels stand in the page's order, the chart first and the order's buttons under it. */
  const phone = PERPS_STANDARDS.phone(3);
  assert.equal(phone.dock, undefined);
  assert.deepEqual(phone.blocks.filter((block) => !block.hidden).map((block) => block.id), ["chart", "ticket", "positions", "orders", "trades", "funding", "history", "account", "book"]);
  for (const width of PERPS_WIDTHS) assert.equal(PERPS_STANDARDS[width](7).updatedAt, 7);
});

function memory(initial = {}) {
  const kept = new Map(Object.entries(initial));
  const writes = [];
  return {
    kept,
    writes,
    store: {
      read: async (page) => kept.get(page) ?? null,
      write: async (page, layout) => {
        writes.push(page);
        kept.set(page, layout);
      },
    },
  };
}

test("a layout kept under `solana/perps.v2` moves to the desk's page once, as the person left it; nothing is deleted", async () => {
  const arranged = { v: 1, preset: "clean", rev: 1, blocks: [{ id: "chart", span: 8, hidden: false }, { id: "book", span: 4, hidden: true }], updatedAt: 42, dock: { grid: {} } };
  const { kept, writes, store } = memory({ [PERPS_LAYOUT_LEGACY]: arranged });
  const perps = perpsLayoutStore(store);
  assert.deepEqual(await perps.read(PERPS_LAYOUT_PAGE), arranged);
  assert.deepEqual(writes, [PERPS_LAYOUT_PAGE], "kept under v3 at once");
  assert.deepEqual(kept.get(PERPS_LAYOUT_LEGACY), arranged, "v2 stays");
  await perps.read(PERPS_LAYOUT_PAGE);
  assert.deepEqual(writes, [PERPS_LAYOUT_PAGE], "moved once");
  /* The narrower widths start from their own «Стандарт»: a desk's arrangement is not a tablet's. */
  assert.equal(await perps.read(perpsLayoutPage("tablet")), null);
  assert.equal(await perps.read(perpsLayoutPage("narrow")), null);
  /* Nothing kept anywhere — the desk's «Стандарт»; and `v2` is never written again. */
  const empty = memory();
  assert.equal(await perpsLayoutStore(empty.store).read(PERPS_LAYOUT_PAGE), null);
  await perpsLayoutStore(empty.store).write(PERPS_LAYOUT_PAGE, arranged);
  assert.deepEqual(empty.writes, [PERPS_LAYOUT_PAGE]);
  /* A layout of v3 of its own wins over anything left under v2. */
  const both = memory({ [PERPS_LAYOUT_LEGACY]: arranged, [PERPS_LAYOUT_PAGE]: { ...arranged, updatedAt: 99 } });
  assert.equal((await perpsLayoutStore(both.store).read(PERPS_LAYOUT_PAGE)).updatedAt, 99);
  assert.deepEqual(both.writes, []);
});

test("Simple and Pro are one terminal at two densities; the warnings that keep money from harm are no setting", () => {
  assert.equal(DEFAULT_PERPS_SETTINGS.mode, "pro", "nothing moves for a person who never opens the settings");
  assert.equal(densityOf("pro"), "compact");
  assert.equal(densityOf("simple"), "regular");
  assert.deepEqual(parsePerpsSettings(null), DEFAULT_PERPS_SETTINGS);
  assert.deepEqual(parsePerpsSettings({ v: 2, mode: "simple" }), DEFAULT_PERPS_SETTINGS);
  const read = parsePerpsSettings({ v: 1, mode: "simple", scale: 125, lines: { orders: false }, orderType: "stop", review: false, guards: { liquidation: false }, warnings: false });
  assert.equal(read.mode, "simple");
  assert.equal(read.scale, 125);
  assert.equal(read.orderType, "market", "an unknown order type falls back");
  assert.deepEqual(read.lines, { positions: true, orders: false, draft: true });
  /* Nothing of a guard survives a read: there is no field to turn one off. */
  assert.deepEqual(Object.keys(read).sort(), Object.keys(DEFAULT_PERPS_SETTINGS).sort());
  for (const guard of PERPS_GUARDS) assert.ok(!(guard in read), guard);
  assert.deepEqual([...PERPS_GUARDS], ["review", "liquidation", "stale", "ceiling"]);
  /* 44 px targets: always in Simple and on a phone. */
  assert.equal(largeTargets({ mode: "simple", targets: "auto" }, false), true);
  assert.equal(largeTargets({ mode: "pro", targets: "auto" }, true), true);
  assert.equal(largeTargets({ mode: "pro", targets: "auto" }, false), false);
  assert.equal(largeTargets({ mode: "pro", targets: "large" }, false), true);
  /* Cards in Simple and wherever the panel is narrower than the whole table. */
  assert.equal(cardsFor("simple", 1600), true);
  assert.equal(cardsFor("pro", CARDS_BELOW - 1), true);
  assert.equal(cardsFor("pro", CARDS_BELOW), false);
  assert.equal(cardsFor("pro", null), false);
});

test("the terminal's sheet ⚙: seven groups, a change seen at once and «Скасувати» back; the guards shown on and grey", () => {
  const sheet = source("perps-settings-sheet.tsx");
  for (const group of ["set.view", "set.layout", "set.chart", "set.orders", "set.protection", "set.numbers", "set.access"]) assert.match(sheet, new RegExp(`<Group title=\\{w\\("${group.replace(".", "\\.")}"\\)\\}`), group);
  assert.match(sheet, /PERPS_GUARDS\.map\(\(guard\) => \(\s*<Switch [^>]*checked disabled \/>/);
  assert.match(sheet, /<dialog/);
  assert.match(sheet, /showModal\(\)/);
  assert.match(sheet, /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*cancel\(\);/);
  /* «Скинути макет» asks first and says the orders and positions stay. */
  assert.match(sheet, /\{w\("reset\.note"\)\}/);
  assert.equal(perpsWord("uk", "reset.note"), "Панелі повернуться до стандарту для цієї ширини. Ордери, позиції й застава не зміняться.");
  /* The first switch between Simple and Pro says the money and the positions stay (spec §5). */
  assert.match(perpsWord("uk", "mode.explainPro"), /^Pro додає інструменти.*Твої кошти й позиції залишаються без змін\.$/);
  assert.match(perpsWord("en", "mode.explainPro"), /Your funds and positions stay as they are\.$/);
  const terminal = source("perps-terminal.tsx");
  assert.match(terminal, /if \(!settings\.explained\) setExplain\(mode\);/);
  assert.match(terminal, /<ResetLayout handle=\{handle\}/);
  assert.match(terminal, /role="group" aria-label=\{modeWord\}/);
  /* Words: both languages, the same blanks, no verdict of safety. */
  for (const key of Object.keys(PERPS_WORDS.en)) assert.ok(key in PERPS_WORDS.uk, key);
});

test("the positions as cards where the table would not stand whole, the order on a phone's own screen, the ticket at the mode's density", () => {
  const page = source("futures-workspace.tsx");
  const panel = source("order-panel.tsx");
  const form = source("perp-ticket-form.tsx");
  const phone = source("perps-phone.tsx");
  assert.match(page, /<TableOrCards mode=\{settings\.mode\} cards=\{positionCards\}/);
  assert.match(page, /<TableOrCards mode=\{settings\.mode\} cards=\{orderCards\}/);
  /* The same cells in the table and the cards: the same data and the same actions. */
  assert.match(page, /render: cells\.actions/);
  assert.match(page, /cells\.actions\(row\)/);
  /* Every action names its market for a screen reader. */
  for (const act of ["pos.edit", "pos.reduce", "pos.close", "ord.cancel"]) assert.match(page, new RegExp(`aria-label=\\{\`\\$\\{pw\\("${act.replace(".", "\\.")}"\\)\\} · \\$\\{row\\.symbol\\}-PERP\`\\}`), act);
  /* A phone: Long and Short open the ticket on a screen of its own. */
  assert.match(page, /phone \? <PhoneTicketLauncher /);
  assert.match(page, /<PhoneTicketScreen open=\{phoneTicket\}[\s\S]{0,200}?<TicketSlot home=\{ticketHome\} \/>/);
  assert.match(phone, /node\.showModal\(\)/);
  assert.match(panel, /sidePick\?: Readonly<\{ side: "long" \| "short"; at: number \}> \| null;/);
  assert.match(form, /data-density=\{density\}/);
  assert.match(panel, /density=\{density\}/);
  /* The chart's lines follow the settings. */
  assert.match(page, /settings\.lines\.positions \? positions : \[\]/);
  assert.match(page, /settings\.lines\.orders \? orders : \[\]/);
  /* The tables never scroll aside on a phone: the head's figures stand in a grid, not a row that scrolls. */
  const css = source("perps.module.css");
  assert.doesNotMatch(css, /\.headStats \{[^}]*overflow-x: auto/);
  assert.match(css, /\.page\[data-targets="large"\] \.rowActions button/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("«?» is back with the truth: orders go through Review and the wallet's signature, not «view only»", () => {
  for (const locale of ["uk", "en"]) assert.doesNotMatch(futuresWord(locale, "help"), /лише перегляд|view only/i, locale);
  assert.match(futuresWord("uk", "help"), /Кожен ордер і кожен рух застави проходить Перевірку і підписує твій гаманець/);
  assert.match(source("perps-terminal.tsx"), /futuresWord\(lang, "help"\)/);
});
