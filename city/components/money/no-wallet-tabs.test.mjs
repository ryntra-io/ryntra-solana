import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* CITY-221: «Гроші» with no wallet — Top up, Send, Pay link, Activity and Portfolio each showed the same «Connect wallet»
   (ryntra.io, 8.11: five tabs, the window's words the same after every tap). */
test("with no wallet Money shows its one action and no tabs; the tabs come with the wallet", () => {
  const win = readFileSync(new URL("./MoneyWindow.tsx", import.meta.url), "utf8");
  assert.match(win, /\{owner \? \(\s*<nav className=\{s\.tabs\} role="tablist"/u);
  assert.match(win, /\{!owner \? \(\s*<Connect \/>/u);
});
