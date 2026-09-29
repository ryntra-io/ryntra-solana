import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256Hex } from "./keccak.ts";

test("Ethereum keccak-256 matches canonical empty and single-byte vectors", () => {
  assert.equal(keccak256Hex("0x"), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256Hex("0x00"), "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a");
});

test("keccak input rejects odd or non-hex data", () => {
  assert.throws(() => keccak256Hex("0x0"), /malformed/);
  assert.throws(() => keccak256Hex("0xzz"), /malformed/);
});
