// Run from repo root: node --test city/components/vault/words.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { VAULT } = await import("./words.ts");
const { guardOf, VAULT_IDS } = await import("../../../lib/vault/levels.ts");

/** CITY-218: what the server says in English — a guard's line on the door, a feed tag — reads in the language on screen. */

const guards = new Map();
for (const id of VAULT_IDS) for (let d = 1; d <= 7; d += 1) {
  const g = guardOf(id, `2026-11-0${d}`);
  guards.set(g.name, g.line);
}

test("every guard's line has its Ukrainian words; English keeps the server's", () => {
  assert.equal(guards.size, 10, "three practice guards and seven of the daily vault");
  for (const [name, line] of guards) {
    assert.equal(VAULT.en.guardLine(name, line), line);
    const uk = VAULT.uk.guardLine(name, line);
    assert.notEqual(uk, line, name);
    assert.match(uk, /[а-яіїєґ]/i, name);
  }
});

test("a feed tag names a guest or a wallet in the language on screen, its code untouched", () => {
  assert.equal(VAULT.en.who("Guest 4BE0"), "Guest 4BE0");
  assert.equal(VAULT.uk.who("Guest 4BE0"), "Гість 4BE0");
  assert.equal(VAULT.uk.who("Wallet 0A1B"), "Гаманець 0A1B");
});
