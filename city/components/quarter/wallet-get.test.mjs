import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* CITY-221: on a phone's browser the top bar's «Connect wallet» said «Get Phantom» — the app store — while Money, Earn
   and the AI chats open Ryntra inside Phantom's own browser. One button, the same way everywhere. */
test("no wallet in this browser: a phone opens Ryntra in Phantom, a computer gets Phantom — one button", () => {
  const chip = read("./WalletChip.tsx");
  const list = chip.slice(chip.indexOf("function WalletList("));
  assert.match(list, /setPhone\(isPhoneUserAgent\(navigator\.userAgent\)\)/u);
  assert.match(list, /href=\{phone \? phantomBrowseUrl\(window\.location\.href, window\.location\.origin\) : PHANTOM_DOWNLOAD_URL\}/u);
  assert.match(list, /\{phone \? t\.openInPhantom : t\.getPhantom\}/u);
  assert.match(list, /className=\{`\$\{s\.display\} \$\{w\.act\} \$\{w\.actLink\}`\}/u, "a button under the finger, not a link inside a line");
  assert.doesNotMatch(list, /\{t\.comeBack\}/u);
  const words = read("./words.ts");
  assert.match(words, /openInPhantom: 'Open in Phantom'/u);
  assert.match(words, /openInPhantom: 'Відкрити в Phantom'/u);
  assert.match(read("./wallet.module.css"), /\.actLink \{\s*display: grid;\s*place-items: center;/u);
});
