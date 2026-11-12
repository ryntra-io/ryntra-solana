import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* CITY-221: the Bots window's head read «MAINNET» beside its tabs on ryntra.io — a network's name on the first screen,
   where the whole city is mainnet and nothing else says so. Test money still says «Devnet» or «Practice». */
test("on mainnet the Bots window names no network; on devnet or in practice it still says so", () => {
  const win = readFileSync(new URL("./BotsWindow.tsx", import.meta.url), "utf8");
  // CITY-219 opened the ladder on mainnet too: either on mainnet, no network word.
  assert.match(win, /\{MANDATE_NET !== 'mainnet' && LADDER_NET !== 'mainnet' && <span className=\{s\.practice\}>\{LADDER_NET \|\| MANDATE_NET \? w\.devnet : w\.practice\}<\/span>\}/u);
  assert.doesNotMatch(win, /w\.mainnet/u);
});
