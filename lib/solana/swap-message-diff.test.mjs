import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { describeSwapMessageChange } from "./swap-message-diff.ts";

const TAKER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const BLOCKHASH = "So11111111111111111111111111111111111111112";
const OTHER_BLOCKHASH = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** SetComputeUnitPrice, little-endian micro-lamports. */
function unitPrice(micros) {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, BigInt(micros), true);
  return { programAddress: COMPUTE_BUDGET, accounts: [], data };
}

function memo(byte = 1) {
  return {
    programAddress: MEMO,
    accounts: [{ address: TAKER, role: AccountRole.WRITABLE_SIGNER }],
    data: new Uint8Array([byte]),
  };
}

function wire({ feePayer = TAKER, blockhash = BLOCKHASH, instructions = [unitPrice(1000), memo()] } = {}) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(feePayer, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: 1000n }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

function kindsOf(reviewed, returned) {
  return describeSwapMessageChange({ reviewedWireBase64: reviewed, returnedWireBase64: returned }).map(
    (difference) => difference.kind,
  );
}

test("a wallet that only re-prices the transaction is named as exactly that", () => {
  const differences = describeSwapMessageChange({
    reviewedWireBase64: wire({ instructions: [unitPrice(1000), memo()] }),
    returnedWireBase64: wire({ instructions: [unitPrice(250000), memo()] }),
  });
  assert.deepEqual(
    differences.map((entry) => entry.kind),
    ["COMPUTE_BUDGET"],
  );
  /* The detail has to carry both numbers, or it is the same dead end with more
     words: the point is that a person can see their wallet's own setting. */
  assert.match(differences[0].detail, /1000 micro-lamports/);
  assert.match(differences[0].detail, /250000 micro-lamports/);
  assert.match(differences[0].detail, /priority-fee setting/);
});

test("structural rewrites are told apart from a re-price", () => {
  assert.deepEqual(
    /* A different fee payer drags the account list and the signer count with
       it, and all three are named — the fee payer first, because that is the
       one that decides whose money pays. */
    kindsOf(wire(), wire({ feePayer: OTHER })),
    ["FEE_PAYER", "ACCOUNT_SET", "SIGNER_COUNT"],
  );
  assert.deepEqual(kindsOf(wire(), wire({ blockhash: OTHER_BLOCKHASH })), ["BLOCKHASH"]);

  const added = kindsOf(wire(), wire({ instructions: [unitPrice(1000), memo(), memo(2)] }));
  assert.ok(added.includes("INSTRUCTION_COUNT"), `expected an instruction-count difference, got ${added}`);
});

test("a payload rewrite that moves nothing structural is still localised", () => {
  const differences = describeSwapMessageChange({
    reviewedWireBase64: wire({ instructions: [unitPrice(1000), memo(1)] }),
    returnedWireBase64: wire({ instructions: [unitPrice(1000), memo(9)] }),
  });
  assert.deepEqual(
    differences.map((entry) => entry.kind),
    ["INSTRUCTION_DATA"],
  );
  assert.match(differences[0].detail, /Instruction 2 of 2/);
  assert.match(differences[0].detail, new RegExp(MEMO));
});

test("undecodable bytes are said out loud rather than compared", () => {
  assert.deepEqual(kindsOf(wire(), "not-base64-at-all"), ["UNDECODABLE"]);
  assert.deepEqual(kindsOf("not-base64-at-all", wire()), ["UNDECODABLE"]);
});

test("identical bytes produce no structural difference to report", () => {
  const same = wire();
  const differences = describeSwapMessageChange({ reviewedWireBase64: same, returnedWireBase64: same });
  /* The caller only asks when the hashes already differ, so this path is the
     "cannot localise" fallback rather than a claim that nothing changed. */
  assert.deepEqual(
    differences.map((entry) => entry.kind),
    ["INSTRUCTION_DATA"],
  );
  assert.match(differences[0].detail, /cannot localise/);
});
