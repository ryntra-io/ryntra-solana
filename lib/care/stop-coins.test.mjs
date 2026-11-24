// «Зупинити й забрати» Доглядача пулу: кожна монета повертається людині зі своїми десятковими знаками, як їх тримає
// ланцюг. Переказ зі знаками іншої монети ланцюг відхиляє (`transferChecked`), і гроші лишились би в сховищі.
import { test } from "node:test";
import assert from "node:assert/strict";

import { chainDecimals } from "./service.server.ts";

const mintAccount = (decimals, length = 82) => {
  const data = new Uint8Array(length);
  data[44] = decimals;
  return data;
};

test("the decimals of a pool's coin: the pool's own read of its mint first", () => {
  assert.equal(chainDecimals({ mint: { decimals: 9 } }), 9, "a staked SOL — 9, not 6");
  assert.equal(chainDecimals({ mint: { decimals: 5 } }), 5, "a coin of 5 decimals — 5");
  assert.equal(chainDecimals({ mint: { decimals: 6 } }), 6);
  assert.equal(chainDecimals({ mint: { decimals: 0 } }), 0);
});

test("the decimals of a pool's coin: else the mint account itself — byte 44, a Token-2022 mint too", () => {
  assert.equal(chainDecimals(undefined, mintAccount(9)), 9);
  assert.equal(chainDecimals({}, mintAccount(5, 234)), 5, "a Token-2022 mint with extensions is longer: the byte stays");
  assert.equal(chainDecimals({ mint: { decimals: 19 } }, mintAccount(8)), 8, "a read past the bound gives way to the account");
});

test("the decimals of a pool's coin: nothing read — none, never a guess", () => {
  assert.equal(chainDecimals(undefined), null);
  assert.equal(chainDecimals(null, null), null);
  assert.equal(chainDecimals(undefined, new Uint8Array(40)), null, "not a mint account");
  assert.equal(chainDecimals({ mint: { decimals: 1.5 } }), null);
});
