import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RXN_URL, rxnOpen } from "./flag.ts";

test("the door to RXN opens only where the switch says `open`: until RXN is live there is no link to it", () => {
  assert.equal(RXN_URL, "https://rxn.gg");
  assert.equal(rxnOpen("open"), true);
  assert.equal(rxnOpen(" open\n"), true);
  for (const value of [undefined, "", "closed", "OPEN", "live", "true", "1"]) assert.equal(rxnOpen(value), false, String(value));
});

test("the city leads to RXN from one place only: the Futures door of the Deck, behind the switch", () => {
  const deck = readFileSync(new URL("../../components/deck/Deck.tsx", import.meta.url), "utf8");
  // Futures are off (30.10): the menu asks without the holding — a holding closes out from Money (`PhoenixLeft`).
  assert.match(deck, /futuresWay\(EXCHANGE_MODE, RXN_OPEN, false\)/);
  const money = readFileSync(new URL("../../components/money/PhoenixLeft.tsx", import.meta.url), "utf8");
  assert.match(money, /phoenixHolds\(account\)/);
  assert.match(deck, /on\.futures === 'rxn' \? openExternal\(RXN_URL\)/);
});
