import { test } from "node:test";
import assert from "node:assert/strict";

import { checkProblemWords, grouped, guardOf, parseRecipientCheck, readRecipient, RECIPIENT_WORDS, riskLine, riskOf, short } from "./recipient.ts";
import { FRIEND, OWNER } from "./test-fixtures.mjs";

test("a Solana address is read the engine's way, trimmed", () => {
  assert.deepEqual(readRecipient(`  ${FRIEND}\n`), { kind: "address", address: FRIEND });
  assert.deepEqual(readRecipient(""), { kind: "empty" });
  assert.deepEqual(readRecipient("   "), { kind: "empty" });
});

test("the engine's three address mistakes are said apart", () => {
  assert.equal(readRecipient("wallet-of-alice").problem, "NOT_AN_ADDRESS");
  assert.equal(readRecipient(`${FRIEND.slice(0, 20)}0${FRIEND.slice(21)}`).problem, "MISREAD_CHARACTER");
  assert.equal(readRecipient(FRIEND.slice(0, 20)).problem, "WRONG_LENGTH");
  assert.equal(readRecipient("wallet-of-alice").text, RECIPIENT_WORDS.NOT_AN_ADDRESS);
});

test("a .skr name is a name to resolve; a .sol name is said plainly to be one the engine does not read", () => {
  assert.deepEqual(readRecipient(" Alice.SKR "), { kind: "name", name: "alice.skr" });
  assert.equal(readRecipient("al ice.skr").problem, "BAD_NAME");
  // A homograph never reads as a name: a Cyrillic «а» is not a .skr label.
  assert.equal(readRecipient("аlice.skr").problem, "BAD_NAME");
  const sol = readRecipient("bonfida.sol");
  assert.equal(sol.problem, "SOL_NAME");
  assert.match(sol.text, /\.skr names/);
});

test("an address of another network belongs on Bridge, and the wallet itself is not a recipient", () => {
  assert.equal(readRecipient("0x1111111111111111111111111111111111111111").problem, "OTHER_NETWORK");
  assert.equal(readRecipient(OWNER, OWNER).problem, "SELF");
  assert.deepEqual(readRecipient(OWNER, FRIEND), { kind: "address", address: OWNER });
});

test("a solana: request or a link goes to the engine's recipient check as typed", () => {
  assert.deepEqual(readRecipient(`solana:${FRIEND}?amount=1`), { kind: "request", text: `solana:${FRIEND}?amount=1` });
  assert.equal(readRecipient("https://ryntra.io/pay/abc").kind, "request");
});

test("the engine's recipient check is believed only in the contract's shape", () => {
  const transfer = parseRecipientCheck({ input: "solana-pay", next: "transfer", problem: null, address: FRIEND, destination: { kind: "wallet", owner: FRIEND, account: FRIEND, opensAccount: true }, asked: { amount: "1.5", mint: null, label: null, message: null }, link: null });
  assert.deepEqual(transfer, { next: "transfer", problem: null, address: FRIEND, opensAccount: true, askedAmount: "1.5", linkUrl: null });
  const refused = parseRecipientCheck({ next: "none", problem: "UNSAFE_SOL_RECIPIENT", address: FRIEND, destination: null, asked: null, link: null });
  assert.equal(refused.next, "none");
  assert.equal(checkProblemWords(refused.problem), "This address cannot safely receive SOL.");
  // A transfer without an address, or a next the contract does not have, is no answer.
  assert.equal(parseRecipientCheck({ next: "transfer", address: null }), null);
  assert.equal(parseRecipientCheck({ next: "maybe", address: FRIEND }), null);
  assert.equal(parseRecipientCheck(null), null);
  assert.equal(parseRecipientCheck({ next: "pay-link", address: null, link: { url: "javascript:alert(1)" } }).linkUrl, null);
  assert.equal(checkProblemWords("SOMETHING_NEW"), "That recipient cannot be paid from here.");
});

test("a look-alike of a recent recipient or of the wallet itself is held (SEC-2)", () => {
  const recent = "Ab1cXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX9Zz9";
  const planted = "Ab1cYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY9Zz9";
  assert.deepEqual(guardOf(planted, OWNER, [recent], true), { lookalike: recent, isNew: true });
  assert.deepEqual(guardOf(recent, OWNER, [recent], true), { lookalike: null, isNew: false });
  const mine = `${OWNER.slice(0, 4)}${"Z".repeat(OWNER.length - 8)}${OWNER.slice(-4)}`;
  assert.equal(guardOf(mine, OWNER, [], true).lookalike, OWNER);
});

test("an address is «new» only once the list was looked at", () => {
  assert.equal(guardOf(FRIEND, OWNER, [], false).isNew, false);
  assert.equal(guardOf(FRIEND, OWNER, [], true).isNew, true);
});

test("an address is shown whole in fours, or short at its ends", () => {
  assert.equal(grouped("ABCDEFGHIJ"), "ABCD EFGH IJ");
  assert.equal(short(FRIEND), `${FRIEND.slice(0, 4)}…${FRIEND.slice(-4)}`);
});

/** An address-evidence read as the engine's route gives it: the source's two engines, sanctions and findings. */
const evidence = (sanctions, findings = { state: "answered", count: 0, high: 0, medium: 0, score: 3, band: "low" }) => ({
  state: "FRESH",
  served: "provider",
  reason: null,
  evidence: { sanctions: { state: sanctions, related: false }, findings },
});

test("the security source's word on the recipient: a line only when it should change the person's mind", () => {
  assert.equal(riskOf(evidence("sanctioned")), "sanctioned");
  assert.equal(riskOf(evidence("clean", { state: "answered", count: 2, high: 1, medium: 0, score: 80, band: "critical" })), "evidence-found");
  assert.equal(riskOf(evidence("clean")), "nothing-found");
  assert.equal(riskOf({ state: "UNAVAILABLE", evidence: null, reason: null, served: "none" }), "unavailable");
  // A body in a shape the contract does not give is no read, never «nothing found».
  for (const body of [null, "x", {}, { state: "FRESH", evidence: { sanctions: null } }]) assert.equal(riskOf(body), "unavailable", JSON.stringify(body));
  assert.equal(riskLine("sanctioned").tone, "error");
  assert.equal(riskLine("evidence-found").tone, "warn");
  for (const quiet of ["nothing-found", "partly-checked", "unsupported", "unavailable", null]) assert.equal(riskLine(quiet), null, String(quiet));
});
