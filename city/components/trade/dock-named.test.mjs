import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* CITY-221: Swap on a phone (390, UK) read «ОТРИМАЄШ БЛИЗЬКО $SOL» and right under it «ОТРИМАЄШ БЛИЗЬКО 0,112 $SOL»: the
   figure sat under the dock, the dock carried it with its label, and the row's own label stood just above. */
test("the dock's «You get» line drops its label while the ticket's own row that names the figure is in sight", () => {
  const dock = read("./DockGet.tsx");
  assert.match(dock, /named\?: RefObject<HTMLElement \| null>;/u);
  assert.match(dock, /const bare = hidden && !!row && row\.top >= seen\.top - 2 && \(row\.top \+ row\.bottom\) \/ 2 < floor;/u);
  assert.match(dock, /\{!bare && <span className=\{s\.label\}>\{label\}<\/span>\}/u);
  assert.match(read("./trade.module.css"), /\.dockGetBare \{\s*justify-content: flex-end;/u);
  const sheet = read("./TradeSheet.tsx");
  assert.match(sheet, /<div ref=\{getRowRef\} className=\{s\.row\}>/u, "the market ticket's «You get» row is measured");
  assert.match(sheet, /<DockGet target=\{getRef\} named=\{getRowRef\}/u);
  // The order ticket measures the row with its label in it: once it is hidden, so is its label — the line keeps its own.
  assert.doesNotMatch(read("./SpotTicket.tsx"), /named=/u);
});

/* CITY-221: the line read before the press named the route's venues — «Fee 0.1% · Raydium CLMM + 2 more · impact» —
   a technical word on the first screen; the venues stand behind «i», in the breakdown, as before. */
test("the terms line before the press is the fee, the least and the impact; the venues wait behind «i»", () => {
  const sheet = read("./TradeSheet.tsx");
  const terms = sheet.slice(sheet.indexOf("function Terms("), sheet.indexOf("function Details("));
  assert.doesNotMatch(terms, /\{figures\.route\}/u);
  assert.match(terms, /\{w\.impact\}/u);
  const details = sheet.slice(sheet.indexOf("function Details("));
  assert.match(details, /<dt>\{w\.route\}<\/dt>\s*<dd>\{route \|\| figures\.route\}<\/dd>/u);
});
