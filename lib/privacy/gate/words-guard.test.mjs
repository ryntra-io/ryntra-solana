// The private mode's words say «private», never what it is not (`docs/research/private-payments-2026-11-19/`,
// README «Чого не казати» and OUTSIDE-SOLANA 11.4): no «anonymous», «untraceable», «like cash», «first private»,
// «mixer» — in English or Ukrainian. Every words file of the private mode is read, today's and those still to come.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

/** Where the private mode's words live. A folder not made yet is read once it is. */
const ROOTS = ["lib/privacy", "terminal/portfolio/private", "terminal/money"];

/** A words file: `words.ts`, `*-words.ts`, `*.words.ts`, `texts.ts`, or any file inside a `words/` folder. */
const WORDS_FILE = /(^|[.-])(words|texts)\.tsx?$/i;

/** What the words never say, by stem, so every form is caught. */
const BANNED = [
  ["анонімно", /анонімн/iu],
  ["anonymous", /anonym/i],
  ["не відстежити", /не\s*відстеж|невідстеж|без\s+слід/iu],
  ["untraceable", /untrace|untrack|cannot be traced|can['’]t be traced|no trace/i],
  ["як готівка", /як\s+готівк/iu],
  ["like cash", /like\s+cash/i],
  ["перший приватний", /перш\p{L}*\s+приватн/iu],
  ["first private", /first\s+private/i],
  ["міксер", /міксер|змішувач/iu],
  ["mixer", /\bmix(er|ers|ing)\b/i],
];

function wordsFiles() {
  const out = [];
  const walk = (dir, inWords) => {
    for (const name of readdirSync(join(REPO, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(REPO, path)).isDirectory()) walk(path, inWords || name === "words");
      else if (/\.tsx?$/.test(name) && (inWords || WORDS_FILE.test(name))) out.push(path);
    }
  };
  for (const root of ROOTS) if (existsSync(join(REPO, root))) walk(root, false);
  return out;
}

/** The words themselves: comments explain the rule and may name what is banned. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\s\/\/\s.*$/gm, "");

function offences(text) {
  return BANNED.filter(([, rule]) => rule.test(text)).map(([name]) => name);
}

test("the guard catches every banned word in both languages, and lets comments explain the rule", () => {
  for (const [name] of BANNED) assert.deepEqual(offences(`x ${name} y`), [name], name);
  for (const form of ["Анонімний гаманець", "anonymously", "невідстежувано", "Untraceable", "як готівку", "Like  cash", "Перша приватна", "First private payroll", "змішувач", "a mixer"]) {
    assert.ok(offences(form).length, form);
  }
  for (const fine of ["Приватно", "Private balance", "Суму й баланс сховано", "Addresses are seen", "cashback", "Remix"]) assert.deepEqual(offences(fine), [], fine);
  assert.deepEqual(offences(withoutComments("/* never «anonymous» */\n// not «mixer»\nconst a = 'Private'; // no «like cash»\n")), []);
});

test("the private mode's words say «private», never «anonymous», «untraceable», «like cash», «first private», «mixer»", () => {
  const files = wordsFiles();
  assert.ok(files.includes("terminal/portfolio/private/words.ts"), "the guard reads the private balance's words");
  for (const path of files) {
    const found = offences(withoutComments(readFileSync(join(REPO, path), "utf8")));
    assert.deepEqual(found, [], `${path}: ${found.join(", ")}`);
  }
});
