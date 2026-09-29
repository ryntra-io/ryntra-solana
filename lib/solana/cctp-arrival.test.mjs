import assert from "node:assert/strict";
import test from "node:test";

import { observeSolanaCctpArrival, readArrivalFacts, reconcileSolanaArrival } from "./cctp-arrival.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECIPIENT = "25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b";
const NONCE = `0x${"c".repeat(64)}`;
const SIGNATURE = `4TX1LSCt597YZVzT${"z".repeat(48)}`;
/* Ethereum's USDC, thirty-two bytes, which is what the token pair is keyed on. */
const REMOTE_TOKEN = "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

/** A handle whose reads are decided by a table rather than by a network. */
function handleWith(answers) {
  return {
    endpoints: [{ role: "primary", host: "solana.example" }],
    timeoutMs: 10,
    retries: 0,
    answered: () => ({ role: "primary", host: "solana.example" }),
    rpc: {
      getAccountInfo: () => ({ send: async () => ({ value: answers.accountInfo ?? null }) }),
      getTransaction: () => ({
        send: async () => {
          if (answers.transactionThrows) throw new Error("history window");
          return answers.transaction ?? null;
        },
      }),
      getTokenAccountBalance: () => ({ send: async () => ({ value: { amount: answers.balance ?? "0" } }) }),
    },
  };
}

const transaction = (overrides = {}) => ({
  slot: 443_500_001n,
  meta: {
    err: null,
    preTokenBalances: [{ accountIndex: 1, mint: USDC, uiTokenAmount: { amount: "1000" } }],
    postTokenBalances: [{ accountIndex: 1, mint: USDC, uiTokenAmount: { amount: "2001000" } }],
    ...overrides.meta,
  },
  transaction: { message: { accountKeys: ["11111111111111111111111111111111", RECIPIENT] } },
  ...overrides,
});

test("an unconsumed replay account means the money has not arrived, and says so plainly", async function () {
  const observation = await observeSolanaCctpArrival(handleWith({ accountInfo: null }), {
    nonce: NONCE,
    sourceDomain: 6,
    remoteTokenHex: REMOTE_TOKEN,
    recipientTokenAccount: RECIPIENT,
  });
  assert.equal(observation.state, "NOT_MINTED");
  assert.equal(observation.nonceState, "UNCONSUMED");
  assert.equal(observation.facts, null);
});

/**
 * The answer that must never flip to its opposite.
 *
 * A consumed replay account means the transfer completed. If the transaction
 * that did it is out of the endpoint's reach, that is a gap in what can be
 * shown, not evidence that nothing happened — and reporting it as *not
 * arrived* is what invites somebody to send the money again.
 */
test("a consumed replay account with no reachable transaction is still an arrival", async function () {
  for (const answers of [
    { accountInfo: { data: ["", "base64"] } },
    { accountInfo: { data: ["", "base64"] }, transactionThrows: true },
    { accountInfo: { data: ["", "base64"] }, transaction: null },
  ]) {
    const observation = await observeSolanaCctpArrival(handleWith(answers), {
      nonce: NONCE,
      sourceDomain: 6,
      remoteTokenHex: REMOTE_TOKEN,
      recipientTokenAccount: RECIPIENT,
      signature: SIGNATURE,
    });
    assert.equal(observation.state, "CONSUMED_UNSEEN");
    assert.equal(observation.nonceState, "CONSUMED");
    assert.match(observation.reason, /has been received/);
  }
});

test("the credited amount comes from the transaction's own before-and-after balances", async function () {
  const observation = await observeSolanaCctpArrival(
    handleWith({ accountInfo: { data: ["", "base64"] }, transaction: transaction() }),
    {
      nonce: NONCE,
      sourceDomain: 6,
      remoteTokenHex: REMOTE_TOKEN,
      recipientTokenAccount: RECIPIENT,
      signature: SIGNATURE,
    },
  );
  assert.equal(observation.state, "MINTED");
  assert.equal(observation.facts.mintedRaw, "2000000");
  assert.equal(observation.facts.mintRecipient, RECIPIENT);
  assert.equal(observation.facts.mintToken, USDC);
  assert.equal(observation.facts.slot, "443500001");
});

/**
 * The first transfer into a brand-new account.
 *
 * A token account created in the same transaction has no pre-balance row at
 * all. Treating that as unreadable would make the one case a person is most
 * likely to hit — their first USDC on Solana — the one this cannot report.
 */
test("an account created by the same transaction opens at zero rather than at unknown", function () {
  const facts = readArrivalFacts(
    transaction({ meta: { err: null, preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: USDC, uiTokenAmount: { amount: "2000000" } }] } }),
    { recipientTokenAccount: RECIPIENT, signature: SIGNATURE, observedBy: "solana.example" },
  );
  assert.equal(facts.mintedRaw, "2000000");
});

test("a failed transaction credits nothing, whatever its balances say", function () {
  const facts = readArrivalFacts(transaction({ meta: { err: { InstructionError: [0, "Custom"] }, preTokenBalances: [], postTokenBalances: [] } }), {
    recipientTokenAccount: RECIPIENT,
    signature: SIGNATURE,
    observedBy: "solana.example",
  });
  assert.equal(facts, null);
});

test("a transaction that never names this account tells us nothing about it", function () {
  const facts = readArrivalFacts(transaction(), {
    recipientTokenAccount: "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj",
    signature: SIGNATURE,
    observedBy: "solana.example",
  });
  assert.equal(facts, null);
});

/**
 * Reconciliation is kept apart from observation for the same reason it is on
 * Base: merging them lets an arrival at the wrong account read as success
 * because *something* arrived.
 */
test("the right amount in the wrong account is a recorded deviation, not a match", async function () {
  const observation = await observeSolanaCctpArrival(
    handleWith({ accountInfo: { data: ["", "base64"] }, transaction: transaction() }),
    { nonce: NONCE, sourceDomain: 6, remoteTokenHex: REMOTE_TOKEN, recipientTokenAccount: RECIPIENT, signature: SIGNATURE },
  );
  assert.equal(
    reconcileSolanaArrival(observation, { recipientTokenAccount: RECIPIENT, receivedRaw: "2000000" }).verdict,
    "MATCHED",
  );

  const wrongAccount = reconcileSolanaArrival(observation, {
    recipientTokenAccount: "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj",
    receivedRaw: "2000000",
  });
  assert.equal(wrongAccount.verdict, "DEVIATION_RECORDED");
  assert.match(wrongAccount.deviations.join(" "), /recipient: expected/);

  const wrongAmount = reconcileSolanaArrival(observation, { recipientTokenAccount: RECIPIENT, receivedRaw: "1999000" });
  assert.equal(wrongAmount.verdict, "DEVIATION_RECORDED");
  assert.match(wrongAmount.deviations.join(" "), /amount: expected 1999000, credited 2000000/);
});

test("an unobserved arrival reconciles to NOT_OBSERVED rather than to a verdict", async function () {
  const observation = await observeSolanaCctpArrival(handleWith({ accountInfo: null }), {
    nonce: NONCE,
    sourceDomain: 6,
    remoteTokenHex: REMOTE_TOKEN,
    recipientTokenAccount: RECIPIENT,
  });
  assert.equal(reconcileSolanaArrival(observation, { recipientTokenAccount: RECIPIENT, receivedRaw: "2000000" }).verdict, "NOT_OBSERVED");
});

test("a malformed nonce or recipient is unreadable rather than an absence", async function () {
  for (const args of [
    { nonce: "0xdead", recipientTokenAccount: RECIPIENT },
    { nonce: NONCE, recipientTokenAccount: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401" },
  ]) {
    const observation = await observeSolanaCctpArrival(handleWith({}), {
      sourceDomain: 6,
      remoteTokenHex: REMOTE_TOKEN,
      ...args,
    });
    assert.equal(observation.state, "UNAVAILABLE");
    assert.notEqual(observation.state, "NOT_MINTED");
  }
});
