import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { headerWalletShows, walletLineCalm, walletsInOrder } from "./wallet-panel.ts";

/* The frame's small rules, held as they are written. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const CASES = [false, true];

test("while the phone's sheet holds the wallet, the header's wallet panel never stands open, so it never takes a tap in the sheet for «outside»", () => {
  for (const open of CASES) for (const connected of CASES) for (const picking of CASES) for (const error of CASES) {
    assert.equal(headerWalletShows({ sheet: true, open, connected, picking, error }), false, JSON.stringify({ open, connected, picking, error }));
  }
});

test("without the sheet: a connected wallet's menu, the list of wallets, or the last step's line — and no empty menu", () => {
  assert.equal(headerWalletShows({ sheet: false, open: true, connected: true, picking: false, error: false }), true);
  assert.equal(headerWalletShows({ sheet: false, open: true, connected: false, picking: false, error: false }), false, "a wallet that let go leaves no empty menu");
  assert.equal(headerWalletShows({ sheet: false, open: false, connected: false, picking: true, error: false }), true);
  assert.equal(headerWalletShows({ sheet: false, open: false, connected: false, picking: false, error: true }), true);
  assert.equal(headerWalletShows({ sheet: false, open: false, connected: true, picking: false, error: false }), false);
});

test("the header's wallet listens for «outside» by that rule, and every way the sheet closes lets a list of wallets go", () => {
  const wallet = read("./Wallet.tsx");
  assert.match(wallet, /const showing = headerWalletShows\(\{ sheet,/);
  assert.match(wallet, /useDismiss\(showing, wrap, dismissWallet\)/);
  const sheet = read("./SectionsSheet.tsx");
  // The cancel lives in the sheet's effect cleanup: its close, a move to another screen, Back and the agent's keys all run it.
  assert.match(sheet, /return \(\) => \{[\s\S]*?cancelWallet\(\);[\s\S]*?\};\s*\}, \[open\]\);/);
});

test("Seeker Connect stands first in the list of wallets wherever it is listed; the rest keep their order", () => {
  const list = [{ name: "Phantom" }, { name: "Solflare" }, { name: "Seeker Connect" }, { name: "Backpack" }];
  assert.deepEqual(walletsInOrder(list).map((w) => w.name), ["Seeker Connect", "Phantom", "Solflare", "Backpack"]);
  assert.deepEqual(walletsInOrder([{ name: "Phantom" }, { name: "Solflare" }]).map((w) => w.name), ["Phantom", "Solflare"]);
  assert.deepEqual(walletsInOrder([]), []);
});

test("a closed sign-in window is said calmly, not in red; a real fault keeps the error's colour", () => {
  assert.equal(walletLineCalm("Nothing was signed. Nothing changed."), true);
  assert.equal(walletLineCalm("Нічого не підписано. Нічого не змінилося."), true);
  assert.equal(walletLineCalm("The wallet did not answer."), false);
  assert.equal(walletLineCalm(null), false);
});
