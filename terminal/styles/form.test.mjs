import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* One form for the whole terminal. No sheet of the terminal writes a corner of its own:

   - `border-radius` is `0`, `var(--r-ctl)` (what a person presses) or `50%` (a coin's logo, an avatar, a state's dot);
     the switch's track alone is `var(--r-round)`, in the kit;
   - a cut corner is the bottom right one, drawn with `--cut` (the one panel a screen acts in) or `--cut-s` (the amber
     button, the phone's agent tab) — in the kit and the frame, and on the home page's own «Say»;
   - nothing is rounded by another name, and no second look stands behind an attribute. */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const FILES = walk(ROOT);
const name = (path) => relative(REPO, path).split("\\").join("/");
const SHEETS = FILES.filter((path) => path.endsWith(".css")).map((path) => ({ path: name(path), css: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

/** Every declaration of a property in a sheet: its value and the selector of the rule it stands in. */
function declarations(css, property) {
  const found = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, selector, body] of css.matchAll(rule)) {
    for (const [, written, value] of body.matchAll(/(?:^|;)\s*([A-Za-z-]+)\s*:\s*([^;]+)/g)) {
      // A vendor's prefix or capital letters name the same property; `!important` changes no value.
      const prop = written.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, "");
      if (property.test(prop)) found.push({ selector: selector.trim().replace(/\s+/g, " "), prop, value: value.trim().replace(/\s+/g, " ").replace(/\s*!important$/, "") });
    }
  }
  return found;
}

const CUT = (token) => `polygon(0 0, 100% 0, 100% calc(100% - var(${token})), calc(100% - var(${token})) 100%, 0 100%)`;
/* Where a cut may be drawn: the kit (the action panel, the amber button), the frame (the phone's agent tab) and the home
   page's own amber «Say». */
const CUT_SHEETS = { "terminal/ui/ui.module.css": ["--cut", "--cut-s"], "terminal/shell/shell.module.css": ["--cut-s"], "terminal/market/home.module.css": ["--cut-s"] };

test("the terminal has sheets to hold, and the form's tokens are the day's decision", () => {
  assert.ok(SHEETS.length >= 15, "the terminal's sheets are read");
  const tokens = SHEETS.find((sheet) => sheet.path === "terminal/styles/terminal.module.css").css;
  assert.match(tokens, /--r-ctl: 4px;/);
  assert.match(tokens, /--r-round: 999px;/);
  assert.match(tokens, /--cut: 20px;/);
  assert.match(tokens, /--cut-s: 12px;/);
  assert.ok(!/--r-panel|--r-tile/.test(tokens), "no radius for a panel or a tile: they are square");
});

test("the form's tokens are set once, on the terminal's root: no sheet gives a corner or a cut a size of its own", () => {
  const wrong = [];
  const FORM_TOKEN = /^--(cut|cut-s|r-ctl|r-round)$/;
  for (const { path, css } of SHEETS) {
    const set = declarations(css, FORM_TOKEN);
    if (path === "terminal/styles/terminal.module.css") {
      // The root sets each of the four exactly once — no second size under a media query.
      assert.deepEqual(set.map((d) => `${d.selector} ${d.prop}`).sort(), [".root --cut", ".root --cut-s", ".root --r-ctl", ".root --r-round"]);
      continue;
    }
    for (const { selector, prop, value } of set) wrong.push(`${path}  ${selector}  { ${prop}: ${value} }`);
  }
  assert.deepEqual(wrong, [], "a form token set again");
  // Nor does a part's own code set one: as a style's key (`'--cut': …`, `['--cut' as string]: …`) or by `setProperty`.
  const SET_IN_CODE = /['"`]--(cut|cut-s|r-ctl|r-round)['"`](\s+as\s+\w+)?\s*\]?\s*:|setProperty\(\s*['"`]--(cut|cut-s|r-ctl|r-round)['"`]/;
  for (const path of FILES.filter((file) => /\.tsx?$/.test(file))) {
    assert.ok(!SET_IN_CODE.test(readFileSync(path, "utf8")), `${name(path)}: a form token set in code`);
  }
});

test("a corner is square, the control's 4 px or a circle — nothing else, in any sheet", () => {
  const wrong = [];
  for (const { path, css } of SHEETS) {
    for (const { selector, prop, value } of declarations(css, /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/)) {
      if (value === "0" || value === "var(--r-ctl)" || value === "50%") continue;
      // The one round control: the switch's track, in the kit.
      if (value === "var(--r-round)" && path === "terminal/ui/ui.module.css" && selector === ".switch") continue;
      wrong.push(`${path}  ${selector}  { ${prop}: ${value} }`);
    }
  }
  assert.deepEqual(wrong, [], "a corner written by hand");
});

test("a cut corner is the bottom right one, by `--cut` or `--cut-s`, only where the form allows it", () => {
  const wrong = [];
  let cuts = 0;
  for (const { path, css } of SHEETS) {
    for (const { selector, value } of declarations(css, /^clip-path$/)) {
      // Not a corner: a part taken off the page for a screen reader only, or a cut switched off.
      if (value === "none" || value === "inset(50%)") continue;
      const token = (CUT_SHEETS[path] ?? []).find((name) => value === CUT(name));
      if (token) {
        cuts++;
        continue;
      }
      wrong.push(`${path}  ${selector}  { clip-path: ${value} }`);
    }
  }
  assert.deepEqual(wrong, [], "a cut written by hand, or in a screen's own sheet");
  assert.ok(cuts >= 3, "the action panel, the amber button and the agent's tab keep the brand's cut");
});

/* The form is the kit's (terminal/ui) and the tokens' (terminal/styles): a screen takes a part and writes no corner of
   its own. The sheets of the screens and of the frame that still write one — 61 declarations in 15 sheets on 17.11 —
   are this closed list, each with its count. It only gets shorter: a corner written anywhere else fails, a corner added
   to a listed sheet fails, and a corner taken out asks for its count to be lowered here. */
const FORM_OUTSIDE_KIT = {
  "terminal/agents/agents.module.css": 4,
  "terminal/coin/chart.module.css": 3,
  "terminal/coin/coin.module.css": 1,
  "terminal/coin/ladder/ladder.module.css": 1,
  "terminal/coin/line.module.css": 2,
  "terminal/coin/ticket.module.css": 1,
  "terminal/earn/earn.module.css": 4,
  "terminal/earn/range/range.module.css": 2,
  "terminal/launch/launch.module.css": 8,
  "terminal/market/depth.module.css": 8,
  "terminal/market/home.module.css": 5,
  "terminal/portfolio/portfolio.module.css": 3,
  "terminal/shell/shell.module.css": 11,
  "terminal/shell/split.module.css": 1,
  "terminal/swap/swap.module.css": 7,
};

test("a corner is the kit's: the sheets outside it that still write one are a closed list that only shrinks", () => {
  const counted = {};
  for (const { path, css } of SHEETS) {
    if (path.startsWith("terminal/ui/") || path.startsWith("terminal/styles/")) continue;
    const corners =
      declarations(css, /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/).length +
      declarations(css, /^clip-path$/).filter(({ value }) => value !== "none" && value !== "inset(50%)").length;
    if (corners) counted[path] = corners;
  }
  for (const [path, corners] of Object.entries(counted)) {
    const pinned = FORM_OUTSIDE_KIT[path];
    assert.ok(pinned !== undefined, `${path}: writes ${corners} corner(s) of its own — take the kit's part, or add the part to the kit`);
    assert.ok(corners <= pinned, `${path}: ${corners} corners, the list allows ${pinned} — a new one belongs in the kit`);
    assert.equal(corners, pinned, `${path}: down to ${corners} — lower its count in FORM_OUTSIDE_KIT to ${corners}`);
  }
  for (const path of Object.keys(FORM_OUTSIDE_KIT)) assert.ok(counted[path], `${path}: writes no corner now — take it off the list`);
});

test("no rule rounds a box by another name, and no second look stands behind an attribute", () => {
  for (const { path, css } of SHEETS) {
    assert.ok(!/data-pro/.test(css), `${path}: no «Pro» rules`);
    assert.ok(!/var\(--r-(panel|tile)\)|var\(--round\)/.test(css), `${path}: no radius token but the control's`);
    assert.ok(!/border-radius\s*:\s*inherit/.test(css), `${path}: a corner is not inherited`);
  }
});

test("no screen writes a corner into its markup", () => {
  for (const path of FILES.filter((file) => /\.tsx$/.test(file))) {
    const source = readFileSync(path, "utf8");
    assert.ok(!/border\w*Radius|clipPath\s*:/.test(source), `${name(path)}: a corner in a style attribute`);
    assert.ok(!/data-pro/.test(source), `${name(path)}: no mark of a second look`);
  }
});

test("the action panel's cut is a layer under its parts: the panel clips nothing that opens out of it", () => {
  const kit = SHEETS.find((sheet) => sheet.path === "terminal/ui/ui.module.css").css;
  const own = declarations(kit, /^clip-path$/).filter((d) => d.selector === ".hi" || d.selector === ".glass");
  assert.deepEqual(own, [], "the panel itself carries no clip");
  assert.ok(declarations(kit, /^clip-path$/).some((d) => d.selector === ".hi::before" && d.value === CUT("--cut")));
  // The edge runs along the cut: a line of the edge's colour across the corner the clip takes off.
  assert.match(kit, /\.hi::before \{[^}]*linear-gradient\(to bottom right, transparent calc\(50% - 1\.3px\), var\(--act-edge\) calc\(50% - 1\.3px\)\) right bottom \/ var\(--cut\) var\(--cut\) no-repeat/);
});
