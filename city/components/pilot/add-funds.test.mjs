// Run from repo root: node --test city/components/pilot/add-funds.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* CITY-237: the money autopilot's card said «Not enough SOL in your wallet for this plan» and left only practice. The
   line now has its way on — Money's top-up — as the agent's card has had since CITY-222. */
test("«not enough» on the money autopilot's card has a way to add funds", () => {
  const card = read("./PilotCard.tsx");
  const line = card.indexOf("data-pilot-short={short}");
  const add = card.indexOf("{short && MONEY_OPEN ? (");
  const dock = card.indexOf("<div className={i.dock}>");
  assert.ok(line > 0 && add > line && dock > add, "the line, its way on, then the dock");
  assert.match(card.slice(add, dock), /onClick=\{\(\) => openMoney\('topup'\)\} data-pilot-topup="">\s*\{w\.add\(short\)\}/u);
  // CITY-239: a button with a frame of its own, under the finger — not the plain words of the card's «quiet» lines.
  assert.match(card.slice(add, dock), /<button type="button" className=\{s\.add\} onClick/u);
  const framed = /\n\.add \{([^}]*)\}/u.exec(read("./pilot.module.css"))?.[1] ?? "";
  assert.match(framed, /box-shadow: inset 0 0 0 1\.5px rgba\(153, 69, 255, 0\.6\);/u, "the frame");
  assert.match(framed, /min-height: 48px;/u, "a finger's height");
  assert.match(framed, /align-self: stretch;/u, "the card's whole width: the card lays its rows in a column");
  const words = read("../../lib/pilot/words.ts");
  assert.match(words, /add: \(asset: string\) => `Add \$\{asset\}`,/u);
  assert.match(words, /add: \(asset\) => `Поповнити \$\{asset\}`,/u);
  // Nothing is «at work» before the signature: the proposal names what would be put to work.
  assert.match(words, /total: \(usd: string\) => `\$\{usd\} to put to work`,/u);
  assert.match(words, /total: \(usd: string\) => `\$\{usd\} піде в роботу`,/u);
  assert.doesNotMatch(words, /total: [^\n]*(at work|у роботі)/u);
});

/* CITY-240: the card of a wallet that cannot fund the plan read «$16.93 to put to work» beside «Not enough SOL in your
   wallet for this plan». The sum is the plan's — the budget of the sentence, or the card's own, at SOL's price now —
   never the wallet's: an empty wallet read money it does not hold, down to «Wallet 25% · $5». */
test("a wallet that cannot fund the plan reads no sum: the line that is true and its one way on", () => {
  const card = read("./PilotCard.tsx");
  // Where the sum comes from: the split's legs at SOL's price — the proposal, before anything is signed.
  assert.match(card, /const total = solUsd !== null \? PILOT_PARTS\.reduce\(\(sum, part\) => sum \+ legsUsd\(split\.legs, solUsd\)\[part\], 0\) : null;/u);
  assert.match(card, /const short = walletShort\(split\.legs, PILOT_NET, holdings\);/u);
  assert.match(card, /const sums = !short;/u);
  // Neither the plan's total nor a part's sum is said while the wallet is short; the shares of the plan stay.
  assert.match(card, /\{total !== null && sums \? <p className=\{i\.sub\}>\{w\.total\(usdText\(total, lang\)\)\}<\/p> : null\}/u);
  assert.match(card, /<Split shares=\{split\.shares\} plan=\{plan\} solUsd=\{sums \? solUsd : null\} \/>/u);
  assert.match(card, /\{values \? <span className=\{s\.sum\}[^\n]*\{usdText\(values\[part\], lang\)\}<\/span> : null\}/u, "a part's sum shows only with a price given");
  // Display only: the plan, its legs and the check itself are read as before, and nothing of the engine is touched.
  assert.doesNotMatch(card, /from '@\/lib\/pilot\/(?!plan')/u);
  assert.match(card, /import \{ legsOf, legsUsd, PILOT_PARTS, type PilotPart, type PilotPlanData \} from '@\/lib\/pilot\/plan';/u);
  // The way on is still there, and practice under it.
  assert.match(card, /\{short && MONEY_OPEN \? \(/u);
  assert.match(card, /<Press label=\{w\.live\}[^\n]*disabled=\{Boolean\(\(split\.preset && PILOT_NET === 'mainnet' && !coin\) \|\| short\)\}/u);
});
