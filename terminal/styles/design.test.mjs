import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";

/* The terminal's look in numbers is one document beside the code, docs/terminal/DESIGN.md: people and agents read the
   numbers there and nowhere else. This file keeps the document and the sheets equal, both ways:

   - every token of the document's head is a variable on the terminal's root with the same value, and every variable
     on the root is a token of the document;
   - a corner and a cut are written only as the document's shapes, and every shape stands in the kit;
   - a colour in the terminal's sheets is a token (`var(--…)`), never a number of its own — only the root writes one;
   - a spacing in px is a step of the document's scale, and every step is in use.

   The sheets that still write colours or spacings by hand are two closed lists below, each with its count; they only
   get shorter. Corners outside the kit are held by ./form.test.mjs. The document lives in the development repository;
   a checkout without it skips what reads it. */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const DOC = new URL("../../docs/terminal/DESIGN.md", import.meta.url);
const README = new URL("../../docs/terminal/README.md", import.meta.url);
const doc = existsSync(DOC) ? readFileSync(DOC, "utf8") : "";
const NO_DOC = !doc && "the look's document is not in this checkout";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const name = (path) => relative(REPO, path).split("\\").join("/");
const SHEETS = walk(ROOT)
  .filter((path) => path.endsWith(".css"))
  .map((path) => ({ path: name(path), css: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }))
  .sort((a, b) => a.path.localeCompare(b.path));
const TOKENS_SHEET = "terminal/styles/terminal.module.css";
const KIT = "terminal/ui/";

/** Every declaration of a sheet: its property (lower case, no vendor's prefix), value and the selector of its rule. */
function declarations(css) {
  const found = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, written, value] of body.matchAll(/(?:^|;)\s*([A-Za-z0-9-]+)\s*:\s*([^;]+)/g)) {
      found.push({
        selector: selector.trim().replace(/\s+/g, " "),
        prop: written.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, ""),
        value: value.trim().replace(/\s+/g, " ").replace(/\s*!important$/, ""),
      });
    }
  }
  return found;
}

const DECLARED = SHEETS.map(({ path, css }) => ({ path, all: declarations(css) }));
const ROOT_VARIABLES = Object.fromEntries(
  DECLARED.find((sheet) => sheet.path === TOKENS_SHEET)
    .all.filter((d) => d.selector === ".root" && d.prop.startsWith("--"))
    .map((d) => [d.prop, d.value]),
);

/* The document's head. Its groups: those whose every key is a variable on the root, and those that have none. */
const VARIABLE_GROUPS = ["colors", "gradients", "rounded", "cut", "fonts", "type", "frame"];
const PLAIN_GROUPS = ["shape", "spacing", "motion", "components"];
const head = doc ? load(doc.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "") : {};
const body = doc.replace(/^---\n[\s\S]*?\n---\n/, "");
const RADIUS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const SPACING = /^(padding|margin)(-[a-z-]+)?$|^(gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap)$/;

/** A list of the sheets and their counts, written as the closed list below is written, to paste in. */
const asList = (counted) => `{\n${Object.entries(counted).map(([path, n]) => `  "${path}": ${n},`).join("\n")}\n}`;

/** A closed list that only gets shorter: no sheet beyond it, no count above it, and a count that fell is lowered here. */
function shrinks(counted, pinned, what) {
  const wrong = [];
  for (const [path, n] of Object.entries(counted)) {
    const allowed = pinned[path];
    if (allowed === undefined) wrong.push(`${path}: ${n} ${what} — not on the list: use the tokens`);
    else if (n > allowed) wrong.push(`${path}: ${n} ${what}, the list allows ${allowed}`);
    else if (n < allowed) wrong.push(`${path}: down to ${n} — lower its count on the list to ${n}`);
  }
  for (const path of Object.keys(pinned)) if (!counted[path]) wrong.push(`${path}: none now — take it off the list`);
  assert.deepEqual(wrong, [], `${wrong.join("\n")}\n\nThe list as the sheets stand now:\n${asList(counted)}`);
}

test("the document's head is the terminal's variables, both ways", { skip: NO_DOC }, () => {
  assert.deepEqual(Object.keys(head).filter((group) => ![...VARIABLE_GROUPS, ...PLAIN_GROUPS, "name", "description"].includes(group)), [], "a group this file does not hold");
  const written = {};
  for (const group of VARIABLE_GROUPS) {
    for (const [key, value] of Object.entries(head[group] ?? {})) {
      assert.ok(!(`--${key}` in written), `--${key}: named twice in the document`);
      written[`--${key}`] = String(value).trim().replace(/\s+/g, " ");
    }
  }
  assert.ok(Object.keys(ROOT_VARIABLES).length >= 40, "the root's variables are read");
  const onlyOnRoot = Object.keys(ROOT_VARIABLES).filter((variable) => !(variable in written));
  const onlyInDocument = Object.keys(written).filter((variable) => !(variable in ROOT_VARIABLES));
  const different = Object.keys(written)
    .filter((variable) => variable in ROOT_VARIABLES && written[variable] !== ROOT_VARIABLES[variable])
    .map((variable) => `${variable}: the document ${written[variable]}, the root ${ROOT_VARIABLES[variable]}`);
  assert.deepEqual({ onlyOnRoot, onlyInDocument, different }, { onlyOnRoot: [], onlyInDocument: [], different: [] });
});

test("a part names only the document's own tokens", { skip: NO_DOC }, () => {
  const known = new Set(Object.entries(head).flatMap(([group, tokens]) => (tokens && typeof tokens === "object" ? Object.keys(tokens).map((key) => `${group}.${key}`) : [])));
  const named = JSON.stringify(head.components ?? {}).matchAll(/\{([a-z-]+\.[a-z0-9-]+)\}/g);
  const unknown = [...named].map((m) => m[1]).filter((ref) => !known.has(ref));
  assert.ok(Object.keys(head.components ?? {}).length >= 5, "the kit's parts are described");
  assert.deepEqual(unknown, [], "a part names a token the document does not have");
});

test("a corner is one of the document's shapes, and every shape stands in the kit", { skip: NO_DOC }, () => {
  const shapes = Object.entries(head.shape).map(([key, value]) => ({ key, value: String(value) }));
  const cornerValues = shapes.filter(({ key }) => !key.startsWith("cut-")).map(({ value }) => value);
  const cutValues = shapes.filter(({ key }) => key.startsWith("cut-")).map(({ value }) => value);
  assert.deepEqual([...cornerValues].sort(), ["0", "50%", "var(--r-ctl)", "var(--r-round)"]);
  assert.equal(cutValues.length, 2, "the panel's cut and the action's cut");

  const wrong = [];
  const kitCorners = new Set();
  const kitCuts = new Set();
  for (const { path, all } of DECLARED) {
    for (const { selector, prop, value } of all) {
      if (RADIUS.test(prop)) {
        if (!cornerValues.includes(value)) wrong.push(`${path}  ${selector}  { ${prop}: ${value} }`);
        if (path.startsWith(KIT)) kitCorners.add(value);
      }
      if (prop === "clip-path" && value !== "none" && value !== "inset(50%)") {
        if (!cutValues.includes(value)) wrong.push(`${path}  ${selector}  { clip-path: ${value} }`);
        if (path.startsWith(KIT)) kitCuts.add(value);
      }
    }
  }
  assert.deepEqual(wrong, [], "a corner or a cut the document does not have");
  assert.deepEqual(cornerValues.filter((value) => !kitCorners.has(value)), [], "a corner of the document the kit does not draw");
  assert.deepEqual(cutValues.filter((value) => !kitCuts.has(value)), [], "a cut of the document the kit does not draw");
});

/* A colour of its own: a hex number, a colour function or a colour's name. A token — `var(--…)` — is not one, nor is
   `color-mix()` of tokens and `transparent`, nor `currentColor`; quoted words (a face's name) are not read. */
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|cyan|magenta)\b/gi;
const unquoted = (value) => value.replace(/url\([^)]*\)/g, "").replace(/(['"])(?:\\.|(?!\1).)*\1/g, "");

/* The sheets that still write a colour by hand, with how many they write — counted on 17.11. The list only gets
   shorter: a colour written anywhere else fails, a colour added to a listed sheet fails, and a colour taken out asks
   for its count to be lowered here. A colour a screen lacks becomes a variable on the root and a token of the document,
   in one change. */
const COLOUR_BY_HAND = {
  "terminal/coin/ladder/ladder.module.css": 1,
  "terminal/coin/ticket.module.css": 7,
  "terminal/earn/earn.module.css": 7,
  "terminal/earn/range/range.module.css": 13,
  "terminal/market/depth.module.css": 47,
  "terminal/market/home.module.css": 7,
  "terminal/portfolio/all.module.css": 4,
  "terminal/portfolio/portfolio.module.css": 5,
  "terminal/shell/kit/kit.module.css": 1,
  "terminal/shell/shell.module.css": 62,
  "terminal/shell/split.module.css": 10,
  "terminal/swap/swap.module.css": 10,
  "terminal/ui/ui.module.css": 41,
};

test("a colour in the terminal's sheets is a token: the sheets that still write one are a closed list that only shrinks", () => {
  const counted = {};
  for (const { path, all } of DECLARED) {
    for (const { selector, prop, value } of all) {
      if (path === TOKENS_SHEET && selector === ".root" && prop.startsWith("--")) continue;
      const colours = unquoted(value).match(COLOUR)?.length ?? 0;
      if (colours) counted[path] = (counted[path] ?? 0) + colours;
    }
  }
  shrinks(counted, COLOUR_BY_HAND, "colour(s) written by hand");
});

/* The sheets that still write a spacing in px off the document's scale, with how many — counted on 17.11. The same
   closed list: it only gets shorter. A spacing in `em` beside a text grows with its face and is not read. */
const SPACING_OFF_SCALE = {
  "terminal/earn/earn.module.css": 4,
  "terminal/earn/range/range.module.css": 2,
  "terminal/market/depth.module.css": 11,
  "terminal/market/home.module.css": 2,
  "terminal/portfolio/all.module.css": 1,
  "terminal/shell/shell.module.css": 10,
  "terminal/shell/split.module.css": 1,
  "terminal/swap/swap.module.css": 5,
  "terminal/ui/ui.module.css": 2,
};

/** Every length in px or rem of a value, as px; a bare number (a multiplier in `calc()`) is not a length. */
const lengths = (value) => [...unquoted(value).matchAll(/(?<![\w.-])-?(\d*\.?\d+)(px|rem)\b/g)].map((m) => Number(m[1]) * (m[2] === "rem" ? 16 : 1));

test("a spacing in px is a step of the document's scale: the sheets off it are a closed list that only shrinks", { skip: NO_DOC }, () => {
  const scale = Object.values(head.spacing).map((step) => Number(String(step).replace(/px$/, "")));
  assert.ok(scale.length >= 10 && scale.every((step) => Number.isFinite(step) && step > 0), "the scale is read");
  const used = new Set();
  const counted = {};
  for (const { path, all } of DECLARED) {
    for (const { prop, value } of all) {
      if (!SPACING.test(prop)) continue;
      for (const px of lengths(value)) {
        if (px === 0) continue;
        if (scale.includes(px)) used.add(px);
        else counted[path] = (counted[path] ?? 0) + 1;
      }
    }
  }
  assert.deepEqual(scale.filter((step) => !used.has(step)), [], "a step of the scale no sheet uses");
  shrinks(counted, SPACING_OFF_SCALE, "spacing(s) off the scale");
});

test("every pace of the document's motion is the kit's or the frame's own", { skip: NO_DOC }, () => {
  const paces = DECLARED.filter(({ path }) => path.startsWith(KIT) || path.startsWith("terminal/shell/"))
    .flatMap(({ all }) => all.filter((d) => d.prop === "transition" || d.prop === "animation").map((d) => d.value));
  const missing = Object.entries(head.motion).filter(([, pace]) => !paces.some((value) => value.includes(String(pace))));
  assert.deepEqual(missing, [], "a pace the kit and the frame do not move at");
});

test("the numbers stand in the document's head alone: its prose and the terminal's rules write no colour", { skip: NO_DOC }, () => {
  assert.ok(!/#[0-9a-f]{6}\b/i.test(body), "the document's prose names a token, not its value");
  const readme = readFileSync(README, "utf8");
  assert.ok(readme.includes("DESIGN.md"), "the rules point to the document");
  assert.ok(!/#[0-9a-f]{6}\b/i.test(readme), "the rules name no colour by its value");
  assert.ok(!/11 · 12 · 13/.test(readme), "the rules do not repeat the type scale");
});
