import { test } from "node:test";
import assert from "node:assert/strict";

import { retell } from "./words.ts";

test("an event retold in Ukrainian: «New pool» is «Новий пул», never «Пул New»; a pair's pool keeps its pair (CITY-188)", () => {
  assert.equal(retell("New pool", "uk"), "Новий пул");
  assert.equal(retell("New coin", "uk"), "Нова монета");
  assert.equal(retell("SOL-USDC pool", "uk"), "Пул SOL-USDC");
  assert.equal(retell("New pool", "en"), "New pool");
});
