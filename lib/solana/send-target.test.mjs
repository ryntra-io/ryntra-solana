import assert from "node:assert/strict";
import test from "node:test";

import { addressProblem, parseSolanaAddress } from "./address.ts";
import { readSendTarget } from "./send-target.ts";

const WALLET = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REFERENCE = "82ZJ7nbGpixjeDCmEhUcmwXYfvurzAgGdtSMuHnUgyny";
const HOSTS = ["ryntra.io", "www.ryntra.io"];

test("the address code says what parseSolanaAddress says, in the same order", () => {
  const cases = [
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    [WALLET, null],
    [`  ${WALLET}  `, null],
    ["wallet-opuATvsQx", "NOT_AN_ADDRESS"],
    ["has a space in it", "NOT_AN_ADDRESS"],
    [`${WALLET.slice(0, 10)}0${WALLET.slice(11)}`, "MISREAD_CHARACTER"],
    [WALLET.slice(0, 20), "WRONG_LENGTH"],
  ];
  for (const [value, code] of cases) {
    assert.equal(addressProblem(value), code, JSON.stringify(value));
    assert.equal(parseSolanaAddress(value).ok, code === null, JSON.stringify(value));
  }
});

test("a bare address is an address", () => {
  assert.deepEqual(readSendTarget(` ${WALLET}\n`, HOSTS), { kind: "address", address: WALLET });
});

test("a Solana Pay request is read by the spec: the recipient, the amount in display units, the token, every reference, the words", () => {
  const url = `solana:${WALLET}?amount=1.5&spl-token=${USDC}&reference=${REFERENCE}&label=Coffee%20shop&message=Order%20%2342`;
  assert.deepEqual(readSendTarget(url, HOSTS), {
    kind: "solana-pay",
    address: WALLET,
    ask: { amount: "1.5", mint: USDC, references: [REFERENCE], label: "Coffee shop", message: "Order #42", memo: null },
  });
  /* The scheme is case-insensitive in practice; the bare form asks nothing. */
  assert.deepEqual(readSendTarget(`SOLANA:${WALLET}`, HOSTS), {
    kind: "solana-pay",
    address: WALLET,
    ask: { amount: null, mint: null, references: [], label: null, message: null, memo: null },
  });
});

test("a malformed or unsupported request is named, never read as something else", () => {
  const invalid = (value) => readSendTarget(value, HOSTS);
  assert.deepEqual(invalid(`solana:${WALLET}?amount=-1`), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
  assert.deepEqual(invalid(`solana:${WALLET}?amount=.5`), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
  assert.deepEqual(invalid(`solana:${WALLET}?amount=1&amount=2`), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
  assert.deepEqual(invalid(`solana:${WALLET}?spl-token=nope`), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
  assert.deepEqual(invalid(`solana:${WALLET}?reference=nope`), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
  assert.deepEqual(invalid("solana:not-an-address"), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
  /* A transaction request asks a shop's server for the transaction — a wallet app pays it, a transfer cannot. */
  assert.deepEqual(invalid("solana:https%3A%2F%2Fshop.example%2Fpay%3Fid%3D1"), { kind: "invalid", input: "solana-pay", problem: "REQUEST_UNSUPPORTED" });
  assert.deepEqual(invalid("solana:https://shop.example/pay"), { kind: "invalid", input: "solana-pay", problem: "REQUEST_UNSUPPORTED" });
});

test("a Ryntra link is recognised only on Ryntra's hosts and only with an id that can be one", () => {
  assert.deepEqual(readSendTarget("https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t", HOSTS), { kind: "pay-link", id: "7mKq3x9ZpQv2Lr5t" });
  assert.deepEqual(readSendTarget("https://www.ryntra.io/pay/7mKq3x9ZpQv2Lr5t/", HOSTS), { kind: "pay-link", id: "7mKq3x9ZpQv2Lr5t" });
  assert.deepEqual(readSendTarget("https://RYNTRA.io/pay/7mKq3x9ZpQv2Lr5t?utm=x", HOSTS), { kind: "pay-link", id: "7mKq3x9ZpQv2Lr5t" });
  assert.deepEqual(readSendTarget("https://ryntra.io/pay/0OIl", HOSTS), { kind: "invalid", input: "pay-link", problem: "LINK_INVALID" });
  /* Someone else's host with the same path is not our link. */
  assert.deepEqual(readSendTarget("https://ryntra.io.evil.example/pay/7mKq3x9ZpQv2Lr5t", HOSTS), { kind: "invalid", input: "address", problem: "NOT_AN_ADDRESS" });
  assert.deepEqual(readSendTarget("https://ryntra.io/app/send", HOSTS), { kind: "invalid", input: "address", problem: "NOT_AN_ADDRESS" });
  /* A stand's own host counts when the route names it. */
  assert.deepEqual(readSendTarget("http://localhost:3040/pay/7mKq3x9ZpQv2Lr5t", [...HOSTS, "localhost:3040"]), { kind: "pay-link", id: "7mKq3x9ZpQv2Lr5t" });
});

test("an amount longer than any token's supply is not read", () => {
  assert.deepEqual(readSendTarget(`solana:${WALLET}?amount=${"9".repeat(60)}`, HOSTS), { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" });
});

test("an amount written with leading zeros is read as the same amount", () => {
  assert.equal(readSendTarget(`solana:${WALLET}?amount=007.50`, HOSTS).ask.amount, "7.50");
  assert.equal(readSendTarget(`solana:${WALLET}?amount=00.5`, HOSTS).ask.amount, "0.5");
  assert.equal(readSendTarget(`solana:${WALLET}?amount=0`, HOSTS).ask.amount, "0");
});
