import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { OLD_PRO_KEY, WIDE_PX, columnsKey, startSet } from "./column-set.ts";

/* One terminal, one variant of every screen: density is the table's own choice — «Columns» — never a mode. */

const TERMINAL = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("a table starts with what the person chose; else all on a wide window or after the old «Pro», else the main ones", () => {
  assert.equal(startSet("main", 2560, "1"), "main", "the choice wins over the window and over the old switch");
  assert.equal(startSet("all", 1280, null), "all");
  assert.equal(startSet(null, WIDE_PX, null), "all", "from 1680 px every column has room");
  assert.equal(startSet(null, WIDE_PX - 1, null), "main");
  assert.equal(startSet(null, 1440, "1"), "all", "who kept «Pro» on loses no density");
  assert.equal(startSet(null, 1440, "0"), "main");
  assert.equal(startSet("everything", 1440, null), "main", "a foreign value is nobody's choice");
  assert.equal(WIDE_PX, 1680);
});

test("each table remembers under its own key, and the old switch's key is only read", () => {
  assert.equal(columnsKey("market"), "ryntra.terminal.columns.market.v1");
  assert.notEqual(columnsKey("market"), columnsKey("earn"));
  assert.equal(OLD_PRO_KEY, "ryntra.terminal.pro.v1");
  const hook = read("./Columns.tsx");
  assert.match(hook, /getItem\(OLD_PRO_KEY\)/);
  assert.ok(!/setItem\(OLD_PRO_KEY/.test(hook), "never written again");
  // The server's page draws the main set; after hydration a screen opens straight in the person's own — no first frame
  // in another set on a move between screens.
  assert.match(hook, /useSyncExternalStore<ColumnSet>\(\s*subscribe,\s*\(\) => read\(table\),\s*\(\) => 'main',\s*\)/);
});

test("«Columns» stands on the Market's and Earn's own bars, and a phone is offered none", () => {
  const market = read("../market/DepthMarket.tsx");
  assert.match(market, /useColumnSet\('market'\)/);
  assert.match(market, /\{narrow \? null : \(\s*<Columns\s+value=\{columnSet\}/);
  // No order by a column that left the table: the list's own order comes back only then.
  assert.match(market, /const sortShown = sort\.key === DEFAULT_SORT\.key \|\| columns\.some\(\(c\) => c\.key === sort\.key\);/);
  assert.match(market, /if \(width && !sortShown\) onSort\(DEFAULT_SORT\);/);
  const earn = read("../earn/EarnScreen.tsx");
  assert.match(earn, /useColumnSet\('earn'\)/);
  assert.match(earn, /narrow \? null : \(\s*<Columns\s+value=\{columnSet\}/);
  assert.match(earn, /if \(next === 'main' && \(sort\.key === 'step' \|\| sort\.key === 'base'\)\) setSort\(START_SORT\);/);
  // The rare filters open with «+ Filters»; while one of them is set they stay open and the control is held.
  const bar = read("../earn/Chooser.tsx");
  assert.match(bar, /const rareSet = filters\.minFees > 0 \|\| filters\.minFeeTvl > 0 \|\| filters\.step !== 'any' \|\| filters\.base !== 'any';/);
  assert.match(bar, /const rare = \(more \|\| rareSet\) && !compact;/);
  assert.match(bar, /aria-expanded=\{rare\} aria-disabled=\{rareSet \|\| undefined\} data-earn="more-filters" onClick=\{rareSet \? undefined : onMore\}/);
  // A desk says a strategy once: the ones with a card are not chips too.
  assert.match(bar, /STRATEGIES\.filter\(\(strategy\) => !CARD_STRATEGIES\.has\(strategy\)\)/);
});

test("no screen reads a mode: usePro() is gone from the terminal", () => {
  for (const path of walk(TERMINAL).filter((file) => /\.tsx?$/.test(file))) {
    const source = readFileSync(path, "utf8");
    assert.ok(!/\busePro\(|shell\/pro['"]/.test(source), `${path}: a screen has one variant`);
  }
});

test("the home page shows one field for the agent: the header's line steps aside where the page has its own", () => {
  const frame = read("../shell/shell.module.css");
  assert.match(frame, /\.app:has\(\[data-terminal='hero'\]\) \.top \.say \{\s*display: none;\s*\}/);
  assert.match(read("../market/HomeHero.tsx"), /data-terminal="hero"/);
  // Ctrl K goes to the field that is on the screen.
  assert.match(read("../shell/AgentLine.tsx"), /querySelector<HTMLInputElement>\("\[data-terminal='hero'\] input"\)/);
});

test("Ryntra's own test coins are not listed for people", () => {
  const lists = read("../launch/Lists.tsx");
  assert.match(lists, /rows\.filter\(\(row\) => !row\.technicalValidation\)\.slice\(0, RYNTRA_MOST\)/);
  assert.ok(!/w\.demo\b/.test(lists));
});
