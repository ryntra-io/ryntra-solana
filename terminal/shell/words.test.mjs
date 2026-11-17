import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { LANGS } from "../../city/lib/i18n/langs.ts";
import { SHELF_IDS } from "./shelves.ts";
import { SHELF_WORDS } from "./words.ts";

/* The terminal speaks English and Ukrainian, both halves of every dictionary alike; no screen writes its words straight
   into the markup; and nothing on it is technical or hype. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(relative(REPO, path).split("\\").join("/"));
  }
  return out;
}

const FILES = [...walk(join(REPO, "terminal")), ...walk(join(REPO, "app", "(terminal)"))];
const WORDS = FILES.filter((path) => /(^|\/)words\.ts$/.test(path));
const read = (path) => readFileSync(join(REPO, path), "utf8");

async function dictionaries() {
  const all = [];
  for (const path of WORDS) {
    const mod = await import(pathToFileURL(join(REPO, path)).href);
    for (const [name, dict] of Object.entries(mod)) if (dict && typeof dict === "object" && "en" in dict && "uk" in dict) all.push({ path, name, dict });
  }
  return all;
}

/** Every string a dictionary can say: its strings, and its functions called with sample words. */
function sayings(half) {
  return Object.values(half).map((value) => (typeof value === "string" ? value : value(...Array.from({ length: value.length }, (_, i) => (i ? "1" : "JUP")))));
}

test("the terminal has dictionaries, and the rail names every shelf in both languages", async () => {
  assert.ok(WORDS.length >= 2);
  for (const lang of LANGS) assert.deepEqual(Object.keys(SHELF_WORDS[lang]).sort(), [...SHELF_IDS].sort(), lang);
  assert.deepEqual(Object.values(SHELF_WORDS.uk), ["Ринок", "Обмін", "Ф’ючерси", "Прогнози", "Заробіток", "Агенти", "Запуск", "Портфель"], "the approved design's names");
});

test("both halves of every dictionary have the same words", async () => {
  for (const { path, name, dict } of await dictionaries()) {
    assert.deepEqual(Object.keys(dict).sort(), [...LANGS].sort(), `${path} ${name}: one half per language`);
    for (const lang of LANGS) {
      assert.deepEqual(Object.keys(dict[lang]).sort(), Object.keys(dict.en).sort(), `${path} ${name}.${lang}: the same keys as English`);
      for (const [key, value] of Object.entries(dict[lang])) {
        assert.equal(typeof value, typeof dict.en[key], `${name}.${lang}.${key}: the same kind as English`);
        if (typeof value === "string") assert.ok(value.trim(), `${name}.${lang}.${key} is empty`);
        else assert.equal(value.length, dict.en[key].length, `${name}.${lang}.${key}: the same arguments as English`);
      }
    }
  }
});

/** Hype the brand never says (the brandbook's list), and the technical words a person never reads on a screen. */
const NEVER = [
  /\bmoon(ing)?\b/i,
  /\b100x\b|\b1000x\b/i,
  /\bguarantee/i,
  /\brisk-?free\b|\briskless\b/i,
  /\bget rich\b|\blambo\b|\bpassive income\b|\bcan't lose\b|\bsure thing\b/i,
  /\bAPI\b|\bendpoint\b|\bengine\b|\bJSON\b|\bRPC\b|\bwebhook\b|\bcron\b|\bdevnet\b|\bstub\b|\bdebug\b|\bTODO\b/i,
  /гарант|без ризику|двигун|ендпоінт/i,
];

test("nothing the terminal says is hype or technical", async () => {
  for (const { path, name, dict } of await dictionaries()) {
    for (const lang of LANGS) {
      for (const said of sayings(dict[lang])) for (const word of NEVER) assert.doesNotMatch(said, word, `${path} ${name}.${lang}: «${said}»`);
    }
  }
});

/** Words that are the same in every language: the brand, the network, coins and wallets by their names. */
const NAMES = new Set(["Ryntra", "RYNTRA", "Solana", "SOL", "USDC", "Phantom", "Solflare", "Backpack", "Jupiter", "Meteora", "Phoenix", "Seeker", "EN", "UA"]);
const SHOWN_ATTRS = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "alt", "placeholder", "label"]);
const visible = (text) => text.replace(/&[a-z]+;/gi, " ").split(/[^\p{L}]+/u).some((word) => word.length > 1 && !NAMES.has(word));

test("no part of the terminal writes its words straight into the markup", () => {
  const found = [];
  for (const path of FILES.filter((p) => p.endsWith(".tsx"))) {
    const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const literal = (node) => {
      if (!node) return;
      if (ts.isParenthesizedExpression(node)) return literal(node.expression);
      if (ts.isConditionalExpression(node)) return literal(node.whenTrue), literal(node.whenFalse);
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return literal(node.left), literal(node.right);
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && visible(node.text)) found.push(`${at(node)} «${node.text}»`);
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
  assert.deepEqual(found, [], `words written straight into the markup — move them to a words.ts:\n${found.join("\n")}`);
});
