import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { tabKeyAt, tabTitle } from "./tab-title.ts";
import { TAB_WORDS } from "./words.ts";

/* The frame names the tab in
   the person's language (`useTabTitle.ts`) with the English names the pages' metadata gives — one list, held here. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("every page of the terminal names its tab in English as its metadata does, and in Ukrainian", () => {
  const paths = { REWARDS_PATH: "/rewards" };
  const pages = walk(join(REPO, "app/(terminal)")).filter((path) => /[\\/]page\.tsx$/.test(path) && !/[\\/]terminal[\\/]kit[\\/]/.test(path));
  const wrong = [];
  for (const file of pages) {
    const name = relative(REPO, file).split("\\").join("/");
    const route = name.replace(/^app\/\(terminal\)/, "").replace(/\/page\.tsx$/, "").replace(/\[[^\]]+\]/g, "x") || "/";
    const key = tabKeyAt(route);
    if (!key) {
      wrong.push(`${name}: its address names no tab — add it to tab-title.ts`);
      continue;
    }
    const said = read(name).match(/buildTerminalMetadata\(\{ name: "([^"]+)", path: (?:"([^"]+)"|(\w+))/);
    if (said) {
      if (said[1] !== TAB_WORDS.en[key]) wrong.push(`${name}: the metadata says «${said[1]}», the tab «${TAB_WORDS.en[key]}»`);
      const path = said[2] ?? paths[said[3]];
      if (path && tabKeyAt(path) !== key && !route.startsWith("/pool")) wrong.push(`${name}: its metadata's address ${path} names another tab`);
    } else if (key !== "home") wrong.push(`${name}: no section name in its metadata — or name it the terminal's line`);
    if (TAB_WORDS.uk[key] === TAB_WORDS.en[key] && !/Meteora/.test(TAB_WORDS.en[key])) wrong.push(`${name}: the Ukrainian tab says the English «${TAB_WORDS.en[key]}»`);
  }
  assert.deepEqual(wrong, []);
});

test("the home page's line is the terminal's own metadata, in each language", () => {
  const seo = read("app/seo.ts");
  const line = seo.match(/export const TERMINAL_WORDS = \{\s*title: "([^"]+)"/)?.[1];
  assert.equal(TAB_WORDS.en.home, line);
  assert.equal(tabTitle("home", "uk"), "Ryntra — твій AI-агент на Solana");
  assert.equal(tabTitle("earn", "uk"), "Заробіток · Ryntra");
  assert.equal(tabTitle("earn", "en"), "Earn · Ryntra");
});

test("the tab follows the address: a bot's own page, a coin, a pool; a page that is not there keeps its own", () => {
  assert.equal(tabKeyAt("/"), "home");
  assert.equal(tabKeyAt("/coin/So11111111111111111111111111111111111111112"), "home");
  assert.equal(tabKeyAt("/bots/grid"), "grid");
  assert.equal(tabKeyAt("/bots"), "bots");
  assert.equal(tabKeyAt("/bots/"), "bots");
  assert.equal(tabKeyAt("/pool/abc"), "pool");
  assert.equal(tabKeyAt("/wallet/abc"), "wallet");
  assert.equal(tabKeyAt("/swapper"), null);
  assert.equal(tabKeyAt("/nothing-here"), null);
});

test("a coin's preview keeps its ticker's own case: «$TSLAx», never «$TSLAX»", () => {
  const coin = read("app/(terminal)/coin/[mint]/page.tsx");
  assert.doesNotMatch(coin, /symbol\.toUpperCase\(\)/);
});

test("the frame names the tab, and the page that is not there is left to name its own", () => {
  const shell = read("terminal/shell/TerminalShell.tsx");
  assert.match(shell, /useTabTitle\(\);/);
  const hook = read("terminal/shell/useTabTitle.ts");
  assert.match(hook, /\[data-terminal="lost"\]/);
  assert.match(read("terminal/shell/lost/Lost.tsx"), /data-terminal="lost"/);
});
