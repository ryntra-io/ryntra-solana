import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { changeText, usdText } from "./figures.ts";

/* One way of writing a figure on every screen, in both languages (the eyes' pass of 20.11, flaws 2 and 3: on
   one Ukrainian screen «$8,9M» and «77K» stood beside «$572,9 тис.» and «10 тис.», «+0,60%» beside «20 %»):
   - a short sum or count takes K, M, B — in Ukrainian too, with its comma;
   - a per cent stands straight after its number, with no space, in both languages.
   The kit's `figures.ts` writes them so; a screen that writes its own units or its own spaced per cent is on a closed
   list below, which only gets shorter — a file that writes them no more is taken off it. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));

test("the kit writes short sums with K, M, B and a per cent with no space — in Ukrainian with its comma", () => {
  assert.equal(usdText(8_900_000, "uk"), "$8,9M");
  assert.equal(usdText(77_000, "uk"), "$77K");
  assert.equal(usdText(1_200_000_000, "uk"), "$1,20B");
  assert.equal(usdText(8_900_000, "en"), "$8.9M");
  assert.equal(changeText(0.6, "uk"), "+0,60%");
  assert.equal(changeText(-1.17, "uk"), "−1,17%");
  assert.equal(changeText(-1.17, "en"), "−1.17%");
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** A file's code without its comments: a word in a comment is shown to no one. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|(^|[^:])\/\/.*$/gm, "$1");

/* A per cent a space away from its number, in a string: «20 %», «${pct} %» — the remainder operator (`at % count`)
   stands before a name, a number or a bracket, and is left alone. */
const SPACED_PERCENT = /[\d}] %(?=[`'"),.;:·]|\s+[^\sA-Za-z0-9_($[\-+!~])/;
/* The Ukrainian words for a thousand, a million and a billion as a figure's unit. */
const UK_UNITS = /тис\.|млн|млрд/;

/* The files that still write a figure their own way, and how — each its section's to put right with the kit's
   `usdText` / `changeText` (or with no space and K, M, B of its own). `terminal/market/depth-view.ts` reads what a
   person types into a filter («2 млн») and stays. */
const OWN_WAY = {
  "terminal/bots/Grid.tsx": "per cent",
  "terminal/bots/grid-words.ts": "per cent",
  "terminal/bots/words.ts": "per cent",
  "terminal/earn/rows.ts": "units",
  "terminal/market/depth-view.ts": "units",
  "terminal/pool/ProTape.tsx": "units",
  "terminal/portfolio/clean-view.ts": "per cent",
  "terminal/portfolio/pnl/words.ts": "per cent",
};

test("no screen writes a figure its own way beyond the closed list — K, M, B and a per cent with no space", () => {
  const wrong = [];
  for (const path of walk(join(REPO, "terminal"))) {
    if (!/\.(ts|tsx)$/.test(path) || /\.test\./.test(path)) continue;
    const name = relative(REPO, path).split("\\").join("/");
    const lines = code(readFileSync(path, "utf8")).split("\n");
    const ways = [lines.some((line) => SPACED_PERCENT.test(line)) && "per cent", lines.some((line) => UK_UNITS.test(line)) && "units"].filter(Boolean);
    for (const way of ways) {
      if (OWN_WAY[name] === way) continue;
      wrong.push(`${name}: writes ${way === "units" ? "«тис.», «млн», «млрд» as a figure's unit — K, M, B with the comma (usdText)" : "a per cent a space away from its number — «20%», straight after it"}`);
    }
  }
  assert.deepEqual(wrong, []);
});
