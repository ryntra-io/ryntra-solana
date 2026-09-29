import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SWAP_WALLET_PRIORITY_FEE_LAMPORTS,
  assessSwapWalletAdoption,
} from "./swap-adoption.ts";

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

const TAKER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ROUTER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

function unitLimit(units) {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET, accounts: [], data };
}

function unitPrice(micros) {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, BigInt(micros), true);
  return { programAddress: COMPUTE_BUDGET, accounts: [], data };
}

function swapInstruction(payload = 7) {
  return {
    programAddress: ROUTER,
    accounts: [{ address: TAKER, role: AccountRole.WRITABLE_SIGNER }],
    data: new Uint8Array([payload, 1, 2, 3]),
  };
}

function wire(instructions) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(TAKER, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

const reviewed = wire([unitLimit(200_000), unitPrice(1_000n), swapInstruction()]);

test("byte-identical bytes keep the venue's own execution lane", () => {
  const adoption = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: reviewed });
  assert.equal(adoption.ok, true);
  assert.equal(adoption.lane, "EXACT");
});

test("a wallet that only re-prices its own compute budget is adopted, and its cost is named", () => {
  /*
   * This is the case that made every swap fail after the approval. The venue's
   * execute lane refuses anything but the transaction it built, so these bytes
   * are adopted and broadcast by this deployment instead — but only after the
   * business instruction is proved untouched.
   */
  const repriced = wire([unitLimit(200_000), unitPrice(375_000n), swapInstruction()]);
  const adoption = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: repriced });
  assert.equal(adoption.ok, true, adoption.ok ? "" : adoption.reason);
  assert.equal(adoption.lane, "WALLET_GUARDS");
  assert.equal(adoption.priorityFeeLamports, "75000");
  assert.match(adoption.detail, /priority fee of at most 75,000 lamports/);
});

test("a wallet cannot spend more of the signer's SOL than the cap under cover of a re-price", () => {
  const greedy = wire([unitLimit(1_400_000), unitPrice(5_000_000n), swapInstruction()]);
  const adoption = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: greedy });
  assert.equal(adoption.ok, false);
  assert.equal(adoption.code, "WALLET_PRIORITY_FEE_TOO_HIGH");
  /* The cap is quoted to the person in the same grouped form the card shows. */
  assert.match(adoption.reason, /1,000,000 this path accepts/);
  assert.equal(MAX_SWAP_WALLET_PRIORITY_FEE_LAMPORTS, 1_000_000n);
});

test("a wallet that invokes a different program in the trade is refused", () => {
  /*
   * What the trade DOES is proved by re-simulating the adopted bytes and
   * reducing them to the signer's own asset deltas — an index rewrite cannot
   * argue with that. What this rule owns is the shape: the same sequence of
   * the same business programs, and nothing new but a bounded budget and a
   * recognised guard.
   */
  const rerouted = wire([
    unitLimit(200_000),
    unitPrice(375_000n),
    { ...swapInstruction(), programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" },
  ]);
  const adoption = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: rerouted });
  assert.equal(adoption.ok, false);
  assert.equal(adoption.code, "WALLET_MODIFIED_BYTES");
  assert.match(adoption.reason, /program this path does not accept/);
});

test("a wallet may attach its own safety checks, and only recognised ones", () => {
  const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
  const assertion = (variant) => ({
    programAddress: LIGHTHOUSE,
    accounts: [{ address: TAKER, role: AccountRole.READONLY_SIGNER }],
    data: new Uint8Array([variant, 0, 0]),
  });

  /* The exact shape the founder's wallet produced: two assertions attached to
     an otherwise untouched trade. */
  const guarded = wire([unitLimit(200_000), unitPrice(375_000n), swapInstruction(), assertion(6), assertion(10)]);
  const adopted = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: guarded });
  assert.equal(adopted.ok, true, adopted.ok ? "" : adopted.reason);
  assert.equal(adopted.lane, "WALLET_GUARDS");
  assert.match(adopted.detail, /2 of its own safety checks/);

  /* A Lighthouse variant that is not one of the two read-only assertions is
     not assumed harmless. */
  const unknownVariant = wire([unitLimit(200_000), unitPrice(375_000n), swapInstruction(), assertion(3)]);
  const refused = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: unknownVariant });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /does not recognise/);
});

test("the things a wallet may never change are still refused", () => {
  const OTHER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  const OTHER_BLOCKHASH = "11111111111111111111111111111111";
  const moved = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(OTHER, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, value),
    (value) => appendTransactionMessageInstructions([unitLimit(200_000), unitPrice(1_000n), swapInstruction()], value),
  );
  assert.equal(
    assessSwapWalletAdoption({
      reviewedWireBase64: reviewed,
      signedWireBase64: getBase64EncodedWireTransaction(compileTransaction(moved)),
    }).reason,
    "The wallet changed which account pays for this transaction.",
  );

  const restamped = wire([unitLimit(200_000), unitPrice(1_000n), swapInstruction()]).replace(/^/, "");
  const rehashed = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(TAKER, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: OTHER_BLOCKHASH, lastValidBlockHeight: 1000n }, value),
    (value) => appendTransactionMessageInstructions([unitLimit(200_000), unitPrice(1_000n), swapInstruction()], value),
  );
  assert.match(
    assessSwapWalletAdoption({
      reviewedWireBase64: restamped,
      signedWireBase64: getBase64EncodedWireTransaction(compileTransaction(rehashed)),
    }).reason,
    /replaced the transaction's blockhash/,
  );
});

test("a wallet may not rewrite what the trade instruction says", () => {
  /*
   * Accounts are deliberately not compared — attaching a guard renumbers every
   * one of them, which is the whole reason this path exists. Instruction DATA
   * is, because the route's own minimum-out lives there. A wallet free to
   * rewrite it could pass a simulation now and take a worse fill in the block,
   * and a live check caught exactly that before this assertion existed.
   */
  const rewritten = wire([unitLimit(200_000), unitPrice(375_000n), swapInstruction(9)]);
  const adoption = assessSwapWalletAdoption({ reviewedWireBase64: reviewed, signedWireBase64: rewritten });
  assert.equal(adoption.ok, false);
  assert.equal(adoption.code, "WALLET_MODIFIED_BYTES");
  assert.match(adoption.reason, /changed what the trade itself does/);
});
