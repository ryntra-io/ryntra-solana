import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LANGS } from "../../../city/lib/i18n/langs.ts";
import { LOST_MARK } from "../../../city/lib/open/lost.ts";
import { FOUND_MAX, findCoins } from "./find.ts";
import { LOST_WORDS } from "./words.ts";

/* The page where there is none (the eyes' pass of 19.11: the city's island, another face, coins in letters and one button
   «TO THE CITY»): in the terminal's frame and language now — its name, a coin search, one way back to the Market, the
   sections as quiet doors. */

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|(^|[^:])\/\/.*$/gm, "$1");

const ROUTE = code("app/not-found.tsx");
const PAGE = code("terminal/shell/lost/Lost.tsx");

test("every address that is not a page is the terminal's page, in its frame, never offered to the index", () => {
  assert.match(ROUTE, /<TerminalFrame>\s*<Lost \/>\s*<\/TerminalFrame>/, "the terminal's frame: rail, header with the agent's line, the phone's tabs");
  assert.match(ROUTE, /from "@\/terminal\/shell\/lost\/Lost"/);
  assert.doesNotMatch(ROUTE, /city\/components\/open\/Lost|buildCityMetadata/, "nothing of the city's island and its card");
  assert.match(ROUTE, /robots: \{ index: false, follow: false \}/);
  assert.match(ROUTE, /openGraph: terminal\.openGraph/, "a shared link carries the terminal's card");
});

test("the page: the kit's page and head, one amber way back to the Market, quiet doors, the walk's mark", () => {
  assert.match(PAGE, /<Page \{\.\.\.marked\}/, `the page carries ${LOST_MARK}, which the walk of old addresses reads`);
  assert.match(PAGE, /const marked = \{ \[LOST_MARK\]: 'missing' \}/);
  assert.match(PAGE, /<PageHead title=\{w\.title\} \/>/);
  assert.match(PAGE, /<ActionBody side=\{side\}/);
  assert.equal((PAGE.match(/className=\{ui\.act\}/g) ?? []).length, 1, "one amber action");
  assert.match(PAGE, /<Link href=\{HOME_PATH\} className=\{ui\.act\}/, "the action leads home: the Market once the terminal is open");
  assert.equal((PAGE.match(/<h1\b/g) ?? []).length, 0, "the head is the kit's");
  assert.doesNotMatch(PAGE, /<Action\b/, "no second amber button");
  assert.match(PAGE, /<QuietLink key=\{id\} href=\{shelfHref\(id, 'live'\)\}/, "the sections that are on, as quiet doors");
  assert.match(PAGE, /shelvesShown\('live'\)\.filter\(\(id\) => id !== 'market'\)/, "the Market is the action, not a door");
  assert.doesNotMatch(PAGE, /CITY_PATH|cityHome|toCity|'\/city'|city\/components/, "no way into the city");
  assert.doesNotMatch(PAGE, /LOST_CODE|404|500/, "no code of an error");
  assert.match(PAGE, /\{open \? <CoinSearch lang=\{lang\} \/> : null\}/, "the search only where a coin's screen answers");
});

test("the words: English and Ukrainian alike, short, nothing technical, nothing of the city", () => {
  assert.deepEqual(Object.keys(LOST_WORDS).sort(), [...LANGS].sort());
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(LOST_WORDS[lang]).sort(), Object.keys(LOST_WORDS.en).sort(), lang);
    for (const [key, value] of Object.entries(LOST_WORDS[lang])) {
      assert.ok(value.length <= 40, `${lang}.${key} is one short line («${value}»)`);
      assert.doesNotMatch(value, /\b404\b|\b500\b|error|route|url|engine|api|помилк|маршрут|адреса сторінки/i, `${lang}.${key} says nothing technical`);
      assert.doesNotMatch(value, /city|міст[оа]/i, `${lang}.${key} names no city`);
    }
  }
  assert.equal(LOST_WORDS.en.toMarket, "To the market");
  assert.equal(LOST_WORDS.uk.toMarket, "На ринок");
});

const tower = (id, symbol, volume24h, extra = {}) => ({ id, symbol, name: `${symbol} coin`, icon: null, price: 1, change24h: 0, volume24h, verified: true, district: "core", ...extra });
const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const TOWERS = [
  tower(SOL, "SOL", 900),
  tower(JUP, "JUP", 500),
  tower("JUPSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", "JupSOL", 800),
  tower("HidDen1111111111111111111111111111111111111", "JUPX", 9_999, { verified: false, district: "strip" }),
  ...Array.from({ length: 8 }, (_, i) => tower(`Ju${i}pmany11111111111111111111111111111111111`.slice(0, 44), `JUP${i}`, i)),
];

test("the search: the Market's coins by ticker, name or address; a ticker typed whole first, then the busiest", () => {
  assert.deepEqual(findCoins(TOWERS, ""), { coins: [], mint: null }, "nothing typed, nothing shown");
  assert.deepEqual(findCoins(TOWERS, "   "), { coins: [], mint: null });
  const jup = findCoins(TOWERS, "jup");
  assert.equal(jup.coins[0].symbol, "JUP", "the ticker typed whole first");
  assert.equal(jup.coins[1].symbol, "JupSOL", "then the busiest");
  assert.equal(jup.coins.length, FOUND_MAX, "one look: five at most");
  assert.ok(!jup.coins.some((coin) => coin.symbol === "JUPX"), "a coin the Market does not name is not offered");
  assert.equal(findCoins(TOWERS, "$sol").coins[0].symbol, "SOL", "a `$` before a ticker is read as people write it");
  assert.deepEqual(findCoins(TOWERS, JUP).coins.map((coin) => coin.id), [JUP], "an address the read holds: its coin");
  assert.equal(findCoins(TOWERS, JUP).mint, null);
  const other = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
  assert.deepEqual(findCoins(TOWERS, ` "${other}" `), { coins: [], mint: other }, "an address the read does not hold still opens its coin's screen");
  assert.deepEqual(findCoins(TOWERS, "nothing-like-it"), { coins: [], mint: null });
});
