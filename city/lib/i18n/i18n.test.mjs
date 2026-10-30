import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { LANG_BOOT_SCRIPT, LANGS, langOf, pickLang } from "./langs.ts";
import { digits, num, pl } from "./dict.ts";

/* CITY-79: the city speaks English and Ukrainian. Every dictionary has both halves with the same keys, and no screen
   of the city writes its words straight into the markup. */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO = join(ROOT, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const FILES = walk(ROOT).map((path) => relative(REPO, path).split("\\").join("/"));

test("the language: a link, then the kept choice, then the device, then English", () => {
  assert.equal(pickLang({}), "en");
  assert.equal(pickLang({ device: ["de-DE", "uk-UA", "en"] }), "uk");
  assert.equal(pickLang({ device: ["en-GB", "uk"] }), "en");
  assert.equal(pickLang({ stored: "uk", device: ["en-US"] }), "uk");
  assert.equal(pickLang({ stored: "en", device: ["uk"] }), "en");
  assert.equal(pickLang({ param: "uk", stored: "en" }), "uk");
  assert.equal(pickLang({ param: "fr", stored: "uk" }), "uk");
  assert.equal(pickLang({ stored: "broken", device: ["pl", "zz"] }), "en");
  assert.equal(langOf("UA"), "uk");
  assert.equal(langOf("uk_UA"), "uk");
  assert.equal(langOf(null), null);
});

test("the boot script picks the same language the store does", () => {
  for (const lang of LANGS) assert.ok(LANG_BOOT_SCRIPT.includes(`"${lang}"`));
  assert.doesNotThrow(() => new Function(LANG_BOOT_SCRIPT));
});

test("the Ukrainian plural and the numbers in the language's own way", () => {
  assert.deepEqual(
    [1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 1.5].map((n) => pl(n, "вежа", "вежі", "веж")),
    ["вежа", "вежі", "вежі", "веж", "веж", "веж", "веж", "вежа", "вежі", "веж", "вежа", "веж", "вежі"],
  );
  assert.equal(digits("$1,234.56 · +12.4% · $1.2M · 24H", "en"), "$1,234.56 · +12.4% · $1.2M · 24H");
  assert.equal(digits("$1,234.56 · +12.4% · $1.2M · 24H", "uk"), "$1\u00a0234,56 · +12,4% · $1,2M · 24H");
  assert.equal(digits("#12 of 340", "uk"), "#12 of 340");
  assert.equal(num(1234.5, { maximumFractionDigits: 1 }, "en"), "1,234.5");
  assert.equal(num(1234.5, { maximumFractionDigits: 1 }, "uk").replace(/\s/g, " "), "1 234,5");
});

test("the dictionaries stand on the server too: no React hook named in the language's modules", () => {
  // The server's routes (app/api/city/**, the moments, the X report) read the city's formatters, which say their words
  // through dict.ts; a module that names a React hook breaks every such route's build («only works in a Client Component»).
  for (const name of ["dict.ts", "lang.ts", "langs.ts"]) {
    const source = readFileSync(join(ROOT, "lib", "i18n", name), "utf8");
    assert.doesNotMatch(source, /from ['"]react['"]/, `${name} imports nothing from react`);
  }
});

test("no style of the city finds an element by its words: a label changes with the language", () => {
  // «[aria-label^='Moments']» stops matching on a Ukrainian screen («Моменти»): the city's styles find a piece by a
  // data attribute of its own (data-city-moments, data-city-search …), never by what it says.
  const found = [];
  for (const path of FILES.filter((p) => p.endsWith(".css"))) {
    const source = readFileSync(join(REPO, path), "utf8");
    source.split("\n").forEach((line, i) => {
      if (/\[(aria-label|title|alt|placeholder)\s*[\^$*~|]?=\s*['"]?[^\]'"]*\p{L}{2}/u.test(line)) found.push(`${path}:${i + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(found, [], `styles that find an element by its words:\n${found.join("\n")}`);
});

const WORDS = FILES.filter((path) => /(^|\/)words\.ts$/.test(path));

test("the city has dictionaries", () => {
  assert.ok(WORDS.length >= 1);
});

for (const path of WORDS) {
  test(`${path}: both halves have the same words`, async () => {
    const mod = await import(pathToFileURL(join(REPO, path)).href);
    const dicts = Object.entries(mod).filter(([, v]) => v && typeof v === "object" && "en" in v && "uk" in v);
    assert.ok(dicts.length, `${path} exports no dictionary`);
    for (const [name, dict] of dicts) {
      assert.deepEqual(Object.keys(dict).sort(), [...LANGS].sort(), `${name}: one half per language`);
      const en = dict.en;
      for (const lang of LANGS) {
        const half = dict[lang];
        assert.deepEqual(Object.keys(half).sort(), Object.keys(en).sort(), `${name}.${lang}: the same keys as English`);
        for (const [key, value] of Object.entries(half)) {
          assert.equal(typeof value, typeof en[key], `${name}.${lang}.${key}: the same kind as English`);
          if (typeof value === "string") assert.ok(value.trim().length > 0, `${name}.${lang}.${key} is empty`);
          else assert.equal(value.length, en[key].length, `${name}.${lang}.${key}: the same arguments as English`);
        }
      }
    }
  });
}

/* Screens that never reach a person of the city: the development stands and concept screens (production answers 404 or
   leaves them out), the owner's X drafts desk, and the share image made for X. */
const NOT_SHOWN = [
  /^city\/components\/look\//,
  /^city\/components\/characters\/dev\//,
  /^city\/components\/bridge\//,
  /^city\/components\/quarter\/kit\/Gallery(Entry)?\.tsx$/,
  /^city\/components\/window\/WindowDemo\.tsx$/,
  /^city\/components\/city\/skyline\/DevView\.tsx$/,
  /^city\/lib\/moments\/drafts\//,
  /^city\/lib\/coin\/og\.server\.tsx$/,
  /^city\/lib\/x\//,
];

/** The props a person reads: the markup's own and the city's components' («label», «hint» …). */
const SHOWN_ATTRS = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "title", "alt", "placeholder", "label", "hint", "line", "kicker", "caption", "heading", "text", "cta"]);

/** Words that are the same in every language: the brand, the network, the coins, wallets and partners by their names. */
const NAMES = new Set([
  "Ryntra",
  "RYNTRA",
  "Solana",
  "SOL",
  "USDC",
  "USDT",
  "Phantom",
  "Solflare",
  "Backpack",
  "Jupiter",
  "Meteora",
  "Phoenix",
  "Telegram",
  "Squads",
  "AGG",
  "Seeker",
  "Skyline",
  "X",
  "PNG",
  "OK",
]);

function visible(text) {
  const rest = text
    .replace(/&[a-z]+;/gi, " ")
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 1 && !NAMES.has(word));
  return rest.length > 0;
}

const SHOWN_TSX = FILES.filter((path) => path.endsWith(".tsx") && !NOT_SHOWN.some((rule) => rule.test(path)));

test("no screen of the city writes its words straight into the markup", () => {
  const found = [];
  for (const path of SHOWN_TSX) {
    const source = readFileSync(join(REPO, path), "utf8");
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const literal = (node) => {
      if (!node) return;
      if (ts.isParenthesizedExpression(node)) return literal(node.expression);
      if (ts.isConditionalExpression(node)) return literal(node.whenTrue), literal(node.whenFalse);
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return literal(node.left), literal(node.right);
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && visible(node.text)) found.push(`${at(node)} «${node.text}»`);
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
        if (visible(parts)) found.push(`${at(node)} «${parts.trim()}»`);
      }
    };
    const visit = (node) => {
      if (ts.isJsxText(node) && visible(node.text)) found.push(`${at(node)} «${node.text.trim()}»`);
      if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) literal(node.expression);
      if (ts.isJsxAttribute(node) && SHOWN_ATTRS.has(node.name.getText(file))) {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init) && visible(init.text)) found.push(`${at(node)} ${node.name.getText(file)}=«${init.text}»`);
        if (init && ts.isJsxExpression(init)) literal(init.expression);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(found, [], `words written straight into the markup — move them to the district's words.ts:\n${found.join("\n")}`);
});

/** The fields of the city's own tables and notices that reach the screen: a button's label, a notice's text, a hint. */
const SHOWN_FIELDS = new Set(["label", "text", "hint", "title", "line", "note", "kicker", "caption", "heading", "cta", "name"]);
/** A dictionary's key or a code («docsLine», «outFilled»): a name for the program, never a word on the screen. */
const CODE = /^[a-z][A-Za-z0-9.]*$/;

test("no screen of the city keeps English words in a table of its own («label», «hint», «text» …)", () => {
  const found = [];
  // The screens, and the stores and views of the library that write a notice or a button's words for them.
  const sources = [
    ...SHOWN_TSX.filter((path) => path.startsWith("city/components/")),
    ...FILES.filter((path) => /^city\/lib\/.+\/([\w-]*store|ticket|tower-window|issuer|positions)\.ts$/.test(path)),
  ];
  for (const path of sources) {
    const source = readFileSync(join(REPO, path), "utf8");
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const literal = (node) => {
      if (!node) return;
      if (ts.isParenthesizedExpression(node)) return literal(node.expression);
      if (ts.isConditionalExpression(node)) return literal(node.whenTrue), literal(node.whenFalse);
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !CODE.test(node.text) && visible(node.text)) found.push(`${at(node)} «${node.text}»`);
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
        if (visible(parts)) found.push(`${at(node)} «${parts.trim()}»`);
      }
    };
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && SHOWN_FIELDS.has(node.name.text)) literal(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(found, [], `English written into a table or a notice — say it through the district's words.ts:\n${found.join("\n")}`);
});

test("the feed's events, written in English, are told in Ukrainian on a Ukrainian screen", async () => {
  const { retell } = await import("../feed/words.ts");
  assert.equal(retell("$1.2M · 24h volume", "en"), "$1.2M · 24h volume");
  assert.equal(retell("$1.2M · 24h volume", "uk"), "$1,2M · обсяг за 24 год");
  assert.equal(retell("Unverified · $85K liquidity", "uk"), "Не перевірено · $85K ліквідності");
  assert.equal(retell("$BONK launched on Ryntra", "uk"), "$BONK запущено на Ryntra");
  assert.equal(retell("+12.4% · 1h", "uk"), "+12,4% · 1 год");
  assert.equal(retell("SOL/USDC pool", "uk"), "Пул SOL/USDC");
  assert.equal(retell("BONK", "uk"), "BONK");
});
