import assert from "node:assert/strict";
import test from "node:test";

import { readsAsMissingAccount } from "./transaction.ts";

/**
 * Telling "this account does not exist" apart from "the read failed".
 *
 * The distinction decides the shape of a transaction: an absent recipient
 * account means one extra instruction and rent the sender must be shown, and an
 * unreadable one means refuse rather than guess. Getting it backwards in either
 * direction is expensive, so both directions are pinned here.
 *
 * The regression this file exists for: `@solana/kit` moved the cluster's own
 * words out of `Error.message` and into `context.__serverMessage`, leaving the
 * message a decode instruction. A classifier reading only the message stopped
 * recognising a missing account, and the whole account-creation path refused
 * with ACCOUNT_STATE_UNREADABLE instead — reproduced against production on
 * 2026-09-03 with a Token-2022 transfer to a wallet that had never held it.
 */

/** The exact shape production threw, message and context together. */
function kitError(serverMessage, code = -32602) {
  const error = new Error(
    `Solana error #${code}; Decode this error by running \`npx @solana/errors decode -- ${code} 'X19jb2RlPS0zMjYwMg=='\``,
  );
  error.context = { __code: code, __serverMessage: serverMessage };
  return error;
}

test("a missing account is recognised from the structured context, not the message", () => {
  assert.equal(readsAsMissingAccount(kitError("Invalid param: could not find account")), true);
  assert.equal(readsAsMissingAccount(kitError("Account not found")), true);
});

test("the older shape still reads as missing, because upgrades are not synchronised", () => {
  /* Deployments and libraries do not move together, so the message that used to
     carry the answer must keep working where it still does. */
  assert.equal(readsAsMissingAccount(new Error("could not find account")), true);
  assert.equal(readsAsMissingAccount(new Error("Invalid param: could not find account")), true);
});

test("a read that merely failed is never reported as an absence", () => {
  /* The asymmetry that matters. Calling a timeout an absence invents an account
     creation: an extra instruction, rent the sender did not agree to, and a
     receipt that then records a deviation about the account it invented. */
  for (const failure of [
    new Error("The request timed out."),
    new Error("fetch failed"),
    kitError("Node is behind by 300 slots", -32004),
    kitError("Too many requests for a specific RPC call", -32429),
    { nothing: "shaped like an error" },
    null,
    undefined,
  ]) {
    assert.equal(readsAsMissingAccount(failure), false, `treated as absent: ${JSON.stringify(failure)}`);
  }
});
