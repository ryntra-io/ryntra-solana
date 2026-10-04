/**
 * The environment lock, proven before there is anything to lock.
 *
 * The rule is two sentences: restate `SOLANA MAINNET · real funds · exact
 * wallet · exact amount · exact provider` before a signature, and return the
 * action to Review if the wallet, the network or the context changed. Every
 * one of those changes is exercised here, one at a time, because a check that
 * only notices two of them at once is a check that passes the day it matters.
 *
 * No value-moving Solana action exists yet — Send is rewritten for mainnet
 * next, and the first owner-signed transfer follows. Writing the gate now is
 * the only order in which it ever gets tested by breaking it rather than by
 * being trusted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { checkEnvironmentLock, isRealFunds, restateEnvironment } from "./environment.ts";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OTHER_WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const AUTHORIZED = {
  network: "mainnet",
  wallet: WALLET,
  provider: "solana-rpc.publicnode.com",
  amount: { raw: "1000000", display: "1 USDC" },
  mint: USDC,
  bound: { recipient: OTHER_WALLET },
};

// -------------------------------------------------------------- the plate --

test("the plate is the rule's five parts, in order", () => {
  const plate = restateEnvironment(AUTHORIZED);
  assert.match(plate, /^SOLANA MAINNET · real funds · /);
  assert.match(plate, /1 USDC/);
  assert.match(plate, /solana-rpc\.publicnode\.com$/);
  assert.match(plate, /9WzD…AWWM/, "the wallet is named, shortened the way base58 shortens");
});

test('"real funds" is never printed off mainnet', () => {
  assert.equal(isRealFunds("mainnet"), true);
  assert.equal(isRealFunds("devnet"), false);
  const plate = restateEnvironment({ ...AUTHORIZED, network: "devnet" });
  assert.ok(!plate.includes("· real funds"), plate);
  assert.match(plate, /SOLANA DEVNET · no real funds/);
});

test("a missing part is stated as missing rather than dropped", () => {
  /* A five-part restatement that quietly becomes three parts reads as a
     shorter promise instead of a missing fact. */
  const plate = restateEnvironment({ ...AUTHORIZED, wallet: null, amount: null });
  assert.match(plate, /no wallet/);
  assert.match(plate, /no amount/);
  assert.equal(plate.split(" · ").length, 5);
});

// ---------------------------------------------------------------- the gate --

test("nothing changed, so the authorization still holds", () => {
  const check = checkEnvironmentLock({ authorized: AUTHORIZED, current: { ...AUTHORIZED } });
  assert.equal(check.verdict, "LOCKED");
  assert.deepEqual(check.changed, []);
});

test("each material change on its own returns the action to Review", () => {
  const cases = [
    ["network", { ...AUTHORIZED, network: "devnet" }],
    ["wallet", { ...AUTHORIZED, wallet: OTHER_WALLET }],
    ["amount", { ...AUTHORIZED, amount: { raw: "2000000", display: "2 USDC" } }],
    ["mint", { ...AUTHORIZED, mint: "So11111111111111111111111111111111111111112" }],
    ["provider", { ...AUTHORIZED, provider: "public.rpc.solanavibestation.com" }],
    ["bound:recipient", { ...AUTHORIZED, bound: { recipient: WALLET } }],
  ];
  for (const [field, current] of cases) {
    const check = checkEnvironmentLock({ authorized: AUTHORIZED, current });
    assert.equal(check.verdict, "RETURN_TO_REVIEW", `${field} changed and the lock held anyway`);
    assert.deepEqual(check.changed, [field]);
    assert.match(check.detail, /returns to Review/);
  }
});

test("a display-only change is not a material change", () => {
  /* The raw amount is what gets signed. Re-rendering `1 USDC` as `1.00 USDC`
     is a formatting decision and must not throw a person back to Review. */
  const check = checkEnvironmentLock({
    authorized: AUTHORIZED,
    current: { ...AUTHORIZED, amount: { raw: "1000000", display: "1.00 USDC" } },
  });
  assert.equal(check.verdict, "LOCKED");
});

test("a bound fact that disappears is a change, not an absence of one", () => {
  /* An action authorized with a recipient and re-presented without one has not
     kept its recipient. A comparison that only walks the current snapshot
     would call this unchanged. */
  const check = checkEnvironmentLock({ authorized: AUTHORIZED, current: { ...AUTHORIZED, bound: {} } });
  assert.equal(check.verdict, "RETURN_TO_REVIEW");
  assert.deepEqual(check.changed, ["bound:recipient"]);
});

test("a disconnected wallet returns the action to Review", () => {
  const check = checkEnvironmentLock({ authorized: AUTHORIZED, current: null });
  assert.equal(check.verdict, "RETURN_TO_REVIEW");
  assert.deepEqual(check.changed, ["wallet"]);
});

test("several changes at once are listed in the plate's own order", () => {
  const check = checkEnvironmentLock({
    authorized: AUTHORIZED,
    current: { ...AUTHORIZED, provider: "elsewhere.example", network: "devnet", wallet: OTHER_WALLET },
  });
  assert.deepEqual(check.changed, ["network", "wallet", "provider"]);
});
