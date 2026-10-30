import { test } from "node:test";
import assert from "node:assert/strict";

import { readOpenAsk, withoutAsk } from "./address.ts";
import { OLD_ADDRESSES, OPEN_WINDOWS } from "./old-addresses.ts";

test("the home's address names a window of the city, and only one it knows", () => {
  assert.deepEqual(readOpenAsk("?open=trade"), { window: "trade" });
  assert.deepEqual(readOpenAsk("open=exchange"), { window: "exchange" });
  assert.deepEqual(readOpenAsk("?open=money&tab=send"), { window: "money", tab: "send" });
  assert.deepEqual(readOpenAsk("?open=money&tab=nope"), { window: "money" }, "a tab Money does not have opens Money where it was");
  assert.deepEqual(readOpenAsk("?open=oracle&market=evt_42"), { window: "oracle", market: "evt_42" });
  assert.deepEqual(readOpenAsk("?open=oracle&page=positions"), { window: "oracle", positions: true });
  assert.deepEqual(readOpenAsk("?open=oracle&market=%3Cscript%3E"), { window: "oracle" }, "a market id is a plain id or nothing");
  for (const search of ["", "?coin=BONK", "?open=", "?open=vault", "?open=__proto__", "?open=TRADE"]) assert.equal(readOpenAsk(search), null, search);
});

test("every window an old address opens is one the city reads", () => {
  for (const row of OLD_ADDRESSES) {
    if (!row.destination.startsWith("/?")) continue;
    const ask = readOpenAsk(row.destination.slice(1).replace(":eventId", "evt_1"));
    assert.ok(ask, `${row.source} → ${row.destination} names a window the city opens`);
    assert.ok(OPEN_WINDOWS.includes(ask.window));
  }
  for (const window of OPEN_WINDOWS) {
    assert.ok(OLD_ADDRESSES.some((row) => row.destination.includes(`open=${window}`)), `${window} is the place of some old address`);
  }
});

test("once open, the ask leaves the address and everything else stays", () => {
  assert.equal(withoutAsk("/", "?open=money&tab=send", ""), "/");
  assert.equal(withoutAsk("/", "?open=oracle&market=evt_1&ref=x", "#drafts"), "/?ref=x#drafts");
  assert.equal(withoutAsk("/", "?coin=BONK&open=trade", ""), "/?coin=BONK");
});
