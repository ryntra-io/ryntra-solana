import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { buildCctpReceiveInstruction, encodeReceiveMessageData } from "./cctp-receive.ts";
import { checkCctpSignedReceive } from "./cctp-receive-check.ts";

const PAYER = "67J8E4sxZn6d1D6Pk8PyGRGoiRyA2U6mmzsqDizk5xJr";
const RECIPIENT = "25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b";
const OTHER_ACCOUNT = "6zNSMmZGMhNyqZMHkx2L63DLuqh5qoqBhaQJPJD7Fvt3";
const FEE_ACCOUNT = "6zNSMmZGMhNyqZMHkx2L63DLuqh5qoqBhaQJPJD7Fvt3";
const BLOCKHASH = "11111111111111111111111111111111";
const MESSAGE = `0x${"00".repeat(376)}`;
const ATTESTATION = `0x${"11".repeat(130)}`;
const OTHER_MESSAGE = `0x${"22".repeat(376)}`;

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

async function receiveInstruction(overrides = {}) {
  return buildCctpReceiveInstruction({
    payer: PAYER,
    caller: PAYER,
    sourceDomain: 6,
    remoteTokenHex: `${"0".repeat(24)}833589fcd6edb6e08f4c7c32d4f71b54bda02913`,
    nonce: `0x${"c".repeat(64)}`,
    mintRecipient: RECIPIENT,
    feeRecipientTokenAccount: FEE_ACCOUNT,
    messageHex: MESSAGE,
    attestationHex: ATTESTATION,
    ...overrides,
  });
}

function wire(instructions, feePayer = PAYER) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(feePayer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, draft),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

const expectation = {
  payer: PAYER,
  messageHex: MESSAGE,
  attestationHex: ATTESTATION,
  recipientTokenAccount: RECIPIENT,
};

test("the transfer that was prepared clears", async function () {
  const check = checkCctpSignedReceive({
    signedWireBase64: wire([await receiveInstruction()]),
    ...expectation,
  });
  assert.equal(check.verdict, "CLEARED");
  assert.deepEqual([...check.companionPrograms], []);
});

test("a compute-budget request alongside it is a companion, not a change", async function () {
  const budget = {
    programAddress: COMPUTE_BUDGET,
    accounts: [],
    data: new Uint8Array([2, 0x40, 0x0d, 0x03, 0x00]),
  };
  const check = checkCctpSignedReceive({
    signedWireBase64: wire([budget, await receiveInstruction()]),
    ...expectation,
  });
  assert.equal(check.verdict, "CLEARED");
  assert.deepEqual([...check.companionPrograms], [COMPUTE_BUDGET]);
});

/**
 * The three substitutions this check exists to catch. Each one would produce a
 * transaction that looks like the one the person read and does something else.
 */
test("a different message is refused, however well-formed", async function () {
  const swapped = await receiveInstruction();
  const check = checkCctpSignedReceive({
    signedWireBase64: wire([{ ...swapped, data: encodeReceiveMessageData(OTHER_MESSAGE, ATTESTATION) }]),
    ...expectation,
  });
  assert.equal(check.verdict, "MESSAGE_CHANGED");
  assert.match(check.detail, /different message from the one Circle signed/);
});

test("a different credited account is refused, which is the field that decides where money lands", async function () {
  const substituted = await receiveInstruction({ mintRecipient: OTHER_ACCOUNT });
  const check = checkCctpSignedReceive({
    signedWireBase64: wire([substituted]),
    ...expectation,
  });
  assert.equal(check.verdict, "RECIPIENT_CHANGED");
});

test("a different fee payer is refused before anything is broadcast", async function () {
  const check = checkCctpSignedReceive({
    signedWireBase64: wire([await receiveInstruction({ payer: OTHER_ACCOUNT, caller: OTHER_ACCOUNT })], OTHER_ACCOUNT),
    ...expectation,
  });
  assert.equal(check.verdict, "FEE_PAYER_CHANGED");
});

test("an unfamiliar programme is a full stop, not a warning", async function () {
  const memo = { programAddress: MEMO, accounts: [], data: new Uint8Array([1, 2, 3]) };
  const check = checkCctpSignedReceive({
    signedWireBase64: wire([await receiveInstruction(), memo]),
    ...expectation,
  });
  assert.equal(check.verdict, "UNREVIEWED_PROGRAM");
  assert.match(check.detail, new RegExp(MEMO));
});

test("a transaction with no receive at all is refused rather than passed as harmless", async function () {
  const budget = { programAddress: COMPUTE_BUDGET, accounts: [], data: new Uint8Array([2, 0x40, 0x0d, 0x03, 0x00]) };
  const check = checkCctpSignedReceive({ signedWireBase64: wire([budget]), ...expectation });
  assert.equal(check.verdict, "NO_RECEIVE_INSTRUCTION");
});

test("two receives in one transaction are refused", async function () {
  const one = await receiveInstruction();
  const check = checkCctpSignedReceive({ signedWireBase64: wire([one, one]), ...expectation });
  assert.equal(check.verdict, "MULTIPLE_RECEIVE_INSTRUCTIONS");
});

test("bytes that are not a transaction are unreadable, never cleared", function () {
  const check = checkCctpSignedReceive({ signedWireBase64: "AAAA", ...expectation });
  assert.equal(check.verdict, "UNREADABLE");
});
