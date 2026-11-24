// «Планшет і одна кнопка агента»: a table fits its panel on a tablet — its quieter columns go a step at a time
// and the row's action stays whole — and the phone's agent's tab has one look on every page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("the kit's table folds by its own box: it tries each step and takes the first that keeps the rows inside", () => {
  const table = read("ui/Table.tsx");
  assert.match(table, /fold\?: readonly string\[\]/u);
  assert.match(table, /new ResizeObserver\(fit\)/u);
  assert.match(table, /if \(inside\(\)\) break;/u);
  // The head's last column, empty or not, inside the box's right edge — the action stands whole.
  assert.match(table, /last\.right <= wrap\.getBoundingClientRect\(\)\.right \+ 1/u);
  assert.match(table, /data-fold=\{fold\}/u, "a cell says from which step it goes");
  const css = read("ui/ui.module.css");
  assert.match(css, /\.tbl\[data-fold='1'\] \[data-fold='1'\],\n\.tbl\[data-fold='2'\] :is\(\[data-fold='1'\], \[data-fold='2'\]\),\n\.tbl\[data-fold='3'\] :is\(\[data-fold='1'\], \[data-fold='2'\], \[data-fold='3'\]\) \{\n  display: none;/u);
});

/** The tracks of a grid: its top-level parts (`minmax(…)`, `repeat(…)` count as written). */
const tracks = (cols) => {
  const out = [];
  for (const part of cols.match(/(?:minmax|repeat)\((?:[^()]|\([^()]*\))*\)|\S+/gu) ?? []) {
    const repeat = /^repeat\((\d+),\s*(.*)\)$/u.exec(part);
    if (repeat) for (let i = 0; i < Number(repeat[1]); i += 1) out.push(...tracks(repeat[2]));
    else out.push(part);
  }
  return out;
};

test("each folding table: every step has one track fewer for each column it lets go, and the action's column stays", () => {
  const cases = [
    ["earn/Chooser.tsx", "COLUMNS_MAIN", "FOLD_MAIN"],
    ["earn/Chooser.tsx", "COLUMNS_ALL", "FOLD_ALL"],
    ["earn/ProList.tsx", "COLUMNS", "FOLD"],
    ["earn/YieldLists.tsx", "STAKE_COLUMNS", "STAKE_FOLD"],
    ["earn/YieldLists.tsx", "LEND_COLUMNS", "LEND_FOLD"],
    ["earn/YieldLists.tsx", "LEND_COLUMNS_GUEST", "LEND_FOLD_GUEST"],
    ["earn/EarnScreen.tsx", "HOLD_COLUMNS", "HOLD_FOLD"],
    ["coin/CoinUnder.tsx", "POSITION_COLUMNS", "POSITION_FOLD"],
    ["coin/CoinUnder.tsx", "ORDER_COLUMNS", "ORDER_FOLD"],
    ["coin/CoinUnder.tsx", "TRADE_COLUMNS", "TRADE_FOLD"],
  ];
  for (const [file, full, fold] of cases) {
    const src = read(file);
    const columns = new RegExp(`const ${full} = '([^']+)';`, "u").exec(src)?.[1];
    const steps = new RegExp(`const ${fold} = \\[([^\\]]+)\\] as const;`, "u").exec(src)?.[1].match(/'[^']+'/gu)?.map((step) => step.slice(1, -1));
    assert.ok(columns && steps?.length, `${file}: ${full} and ${fold}`);
    let was = tracks(columns).length;
    for (const step of steps) {
      const now = tracks(step).length;
      assert.ok(now < was, `${file} ${fold}: each step narrower`);
      was = now;
    }
    // The table itself takes the steps.
    assert.match(src, new RegExp(`fold=\\{${fold}\\}|fold=\\{[^}]*${fold}`, "u"), `${file}: the table takes ${fold}`);
  }
});

test("the portfolio's groups fold the same way, their worth and controls on every step", () => {
  const groups = read("portfolio/Groups.tsx");
  assert.match(groups, /const foldOf = \(leads: readonly string\[\], own: boolean\): string\[\] => leads\.map\(\(lead\) => columnsOf\(lead, own\)\);/u);
  for (const lead of ["POOL", "STAKE", "LEND", "OTHER", "COIN", "DUST"]) assert.match(groups, new RegExp(`fold=\\{foldOf\\(${lead}_FOLD, own\\)\\}`, "u"), lead);
});

test("the coin's market tables take a phone's columns in a box their desk columns do not fit (a tablet's panel)", () => {
  const tabs = read("coin/MarketTabs.tsx");
  assert.match(tabs, /return phone \|\| \(width > 0 && width < leastWidth\(cols\)\);/u);
  assert.match(tabs, /const narrow = useCompact\(HOLDER_COLS\);/u);
  assert.match(tabs, /const narrow = useCompact\(TRADER_COLS\);/u);
  assert.match(read("coin/CoinUnder.tsx"), /<TapeBox className=\{u\.underBody\}>/u);
});

test("the phone's agent's tab: one amber look on every page, the home page too", () => {
  const css = read("shell/shell.module.css");
  assert.deepEqual(css.split("\n").filter((line) => /\.gem\b/u.test(line) && line.includes("{")), [".gem {"]);
  assert.doesNotMatch(css, /ask-dock'\]\) \.gem/u);
});
