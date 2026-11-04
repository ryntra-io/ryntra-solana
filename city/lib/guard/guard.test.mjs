import assert from "node:assert/strict";
import test from "node:test";

import { checkBody, headline, readInput } from "./check.ts";
import { GUARD_OPEN, guardOpen } from "./flag.ts";
import { setGuardFetch, useGuard } from "./store.ts";

const TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDsPfx";

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

const verdict = (overrides = {}) => ({
  schema: "ryntra.ward.check",
  schemaVersion: "1.0.0",
  verdict: "block",
  line: "Hands your wallet to another program — for good.",
  reasons: [
    { code: "OWNER_CHANGED", check: "authority", level: "block", line: "Hands your wallet to another program — for good.", detail: "…", accounts: [], source: "The transaction's own instructions" },
    { code: "PROGRAMS_UNKNOWN", check: "program", level: "info", line: "Calls one program Ryntra does not name.", detail: null, accounts: [], source: "The transaction's own instructions" },
  ],
  notRead: 0,
  input: { kind: "transaction", network: "mainnet", version: "v0", signer: null, signed: false, programs: [] },
  effects: { simulated: true, changes: [], feeLamports: "5000", rentLamports: "0" },
  intent: null,
  checkedAt: "2026-10-31T10:00:00.000Z",
  ...overrides,
});

test("the Guard place opens only on the exact word «open», and is shut where the switch is not set", () => {
  assert.equal(guardOpen("open"), true);
  assert.equal(guardOpen(" open\n"), true);
  for (const value of [undefined, "", "closed", "OPEN", "true", "1"]) assert.equal(guardOpen(value), false, String(value));
  assert.equal(process.env.NEXT_PUBLIC_RYNTRA_CITY_GUARD, undefined);
  assert.equal(GUARD_OPEN, false);
});

test("what was pasted: base64 long enough is a transaction (its line breaks dropped); anything else is a link", () => {
  assert.deepEqual(readInput(`  ${TX.slice(0, 50)}\n${TX.slice(50)}  `), { kind: "transaction", value: TX });
  assert.deepEqual(readInput("solana:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin?amount=1"), { kind: "link", value: "solana:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin?amount=1" });
  assert.deepEqual(readInput("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"), { kind: "link", value: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" });
  assert.equal(readInput("   "), null);
});

test("the body: the wallet on screen goes with a link it would pay, never with a transaction judged as its own fee payer", () => {
  const owner = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
  assert.deepEqual(checkBody({ input: { kind: "transaction", value: TX }, intentText: " send 1 SOL to x ", signer: owner }), { transaction: TX, intentText: "send 1 SOL to x" });
  assert.deepEqual(checkBody({ input: { kind: "link", value: "solana:abc" }, intentText: "", signer: owner }), { link: "solana:abc", signer: owner });
});

test("the window asks the engine once and shows its verdict; a new paste clears it", async () => {
  const calls = [];
  setGuardFetch(async (url, init) => {
    calls.push({ url, init });
    return reply(200, verdict())();
  });
  useGuard.getState().reset();
  useGuard.getState().setText(TX);
  await useGuard.getState().check(null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/ward/check");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-Ryntra-API"], "1");
  assert.deepEqual(JSON.parse(calls[0].init.body), { transaction: TX });
  assert.equal(useGuard.getState().phase, "done");
  assert.equal(useGuard.getState().result.verdict, "block");
  assert.deepEqual(headline(useGuard.getState().result).map((reason) => reason.code), ["OWNER_CHANGED"], "information waits in the details");
  useGuard.getState().setText(`${TX}A`);
  assert.equal(useGuard.getState().phase, "idle");
  assert.equal(useGuard.getState().result, null);
});

test("input the engine cannot read, a busy engine and a silent one read as three different lines", async () => {
  useGuard.getState().reset();
  useGuard.getState().setText("hello");
  setGuardFetch(reply(400, { error: { code: "VALIDATION_ERROR", message: "This is not a Solana transaction, address or payment link." } }));
  await useGuard.getState().check(null);
  assert.equal(useGuard.getState().phase, "failed");
  assert.equal(useGuard.getState().failure, "unreadable");
  setGuardFetch(reply(429, { error: { code: "RATE_LIMITED", message: "Too many requests." } }));
  await useGuard.getState().check(null);
  assert.equal(useGuard.getState().failure, "busy");
  setGuardFetch(async () => {
    throw new Error("offline");
  });
  await useGuard.getState().check(null);
  assert.equal(useGuard.getState().failure, "offline");
});
