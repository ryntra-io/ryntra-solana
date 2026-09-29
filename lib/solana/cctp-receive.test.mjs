import assert from "node:assert/strict";
import test from "node:test";

import {
  base58Encode,
  buildCctpReceiveInstruction,
  CCTP_USED_NONCE_ACCOUNT_BYTES,
  deriveCctpReceiveAccounts,
  encodeReceiveMessageData,
  RECEIVE_MESSAGE_DISCRIMINATOR,
  readTokenMessengerFeeRecipient,
  TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET,
} from "./cctp-receive.ts";

/**
 * One real mainnet receive, used as the specification.
 *
 * Circle publishes no IDL for these programs, and the twenty accounts a
 * `receive_message` names are in an order nothing this repository could cite
 * writes down. So the builder was derived against
 * `2yFd9zR5JSfPJFvMFhKDVjPt3tZamgDgsDm2XWLCfzAeq1m6Du64uxTAHsNnaTWE6qRJZ1twiaspbFyzpapvKRsE`
 * — an Ethereum-to-Solana transfer of 17.082310 USDC — and this test reproduces
 * it address for address.
 *
 * That makes it a regression against Circle as much as against us: a redeployed
 * programme, a moved seed or a reordered account fails here, on the exact field
 * that moved, rather than on a transaction somebody is holding a wallet prompt
 * for.
 */
const LIVE = Object.freeze({
  payer: "67J8E4sxZn6d1D6Pk8PyGRGoiRyA2U6mmzsqDizk5xJr",
  sourceDomain: 0,
  /* Ethereum's USDC, left-padded to the thirty-two bytes the token pair uses. */
  remoteTokenHex: "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  nonce: "0x24c7dfc55cd41af55ac01403bb227081d218e0f64e7562b79f1ab9e2f418e779",
  mintRecipient: "25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b",
  feeRecipientTokenAccount: "6zNSMmZGMhNyqZMHkx2L63DLuqh5qoqBhaQJPJD7Fvt3",
  accounts: [
    "67J8E4sxZn6d1D6Pk8PyGRGoiRyA2U6mmzsqDizk5xJr",
    "67J8E4sxZn6d1D6Pk8PyGRGoiRyA2U6mmzsqDizk5xJr",
    "DsAdX23SVpTPYhKP2ua1mx8gTPqLyzx7a43cyxYjS2up",
    "W1k5ijkaSTo5iA5zChNpfzcy796fLhkBxfmJuR8W8HU",
    "7dGUii7C8vsgCs843eYfRdUkvQptJkvFeC4EFuZZBdG2",
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
    "11111111111111111111111111111111",
    "2PcXTomVAbX5Es1NUZUkxwuCm8tvV4NmRk3fmQWFCWoV",
    "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    "AawthJCGRmggpfv9MMWV6Jmo9cue4gL9wUZgRBShg58W",
    "3EzN2mcmdfSNGXRCAixSpTteK6ywdmFDZZWvkMnznFt9",
    "E1bQJ8eMMn3zmeSewW3HQ8zmJr7KR75JonbwAtWx2bux",
    "CRBBbuLCyrkQy4dCTHxqstSmDQv4ajBeUVb9qUdMVaP1",
    "E4ZYkwNfR73MqQB6Kfmf515aQVBk2Wxjp57LbkaGWQ5q",
    "6zNSMmZGMhNyqZMHkx2L63DLuqh5qoqBhaQJPJD7Fvt3",
    "25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b",
    "6xTBTqJMBr5m7BKqVxmW2x11DfqUwtD3TJsqpxELx72L",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "6TCCnJ9R1m1RXFzyoH7GYH2J6NJDtZaUvfipPuLWxHNd",
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  ],
});

const liveIntent = (overrides = {}) => ({
  payer: LIVE.payer,
  caller: LIVE.payer,
  sourceDomain: LIVE.sourceDomain,
  remoteTokenHex: LIVE.remoteTokenHex,
  nonce: LIVE.nonce,
  mintRecipient: LIVE.mintRecipient,
  feeRecipientTokenAccount: LIVE.feeRecipientTokenAccount,
  messageHex: `0x${"00".repeat(376)}`,
  attestationHex: `0x${"11".repeat(130)}`,
  ...overrides,
});

test("the builder reproduces a real mainnet receive, address for address", async function () {
  const instruction = await buildCctpReceiveInstruction(liveIntent());
  assert.equal(String(instruction.programAddress), "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
  assert.equal(instruction.accounts.length, LIVE.accounts.length);
  instruction.accounts.forEach((account, index) => {
    assert.equal(String(account.address), LIVE.accounts[index], `account ${index}`);
  });
});

test("the payer signs and pays, the caller only signs", async function () {
  const instruction = await buildCctpReceiveInstruction(liveIntent());
  /* Roles, not just addresses. A payer that is not writable cannot fund the
     replay account, and a caller that is not a signer fails a pinned message. */
  assert.equal(instruction.accounts[0].role, 3, "payer is a writable signer");
  assert.equal(instruction.accounts[1].role, 2, "caller is a read-only signer");
  /* The three accounts value actually moves through. */
  for (const index of [4, 11, 12, 14, 15, 16]) {
    assert.equal(instruction.accounts[index].role % 2, 1, `account ${index} is writable`);
  }
});

test("the seeds are the ones the chain uses, not the ones that look right", async function () {
  const derived = await deriveCctpReceiveAccounts({
    sourceDomain: LIVE.sourceDomain,
    remoteTokenHex: LIVE.remoteTokenHex,
    nonce: LIVE.nonce,
  });
  assert.equal(derived.usedNonce, LIVE.accounts[4]);
  assert.equal(derived.remoteTokenMessenger, LIVE.accounts[10]);
  assert.equal(derived.tokenPair, LIVE.accounts[13]);
  assert.equal(derived.custodyTokenAccount, LIVE.accounts[16]);

  /* The source domain is an ASCII string in both seeds. A different domain is a
     different pair of accounts, which is the whole point of asking. */
  const other = await deriveCctpReceiveAccounts({
    sourceDomain: 6,
    remoteTokenHex: LIVE.remoteTokenHex,
    nonce: LIVE.nonce,
  });
  assert.notEqual(other.remoteTokenMessenger, derived.remoteTokenMessenger);
  assert.notEqual(other.tokenPair, derived.tokenPair);
  /* And the replay account follows the nonce alone, so it is the same either
     way — it is the message's identity, not the lane's. */
  assert.equal(other.usedNonce, derived.usedNonce);
});

test("a different nonce is a different replay account, which is what makes it a guard", async function () {
  const first = await deriveCctpReceiveAccounts({
    sourceDomain: LIVE.sourceDomain,
    remoteTokenHex: LIVE.remoteTokenHex,
    nonce: LIVE.nonce,
  });
  const second = await deriveCctpReceiveAccounts({
    sourceDomain: LIVE.sourceDomain,
    remoteTokenHex: LIVE.remoteTokenHex,
    nonce: `0x${"ab".repeat(32)}`,
  });
  assert.notEqual(first.usedNonce, second.usedNonce);
});

test("the instruction data is the discriminator and two length-prefixed vectors", function () {
  const data = encodeReceiveMessageData(`0x${"00".repeat(376)}`, `0x${"11".repeat(130)}`);
  assert.equal(Buffer.from(data.subarray(0, 8)).toString("hex"), RECEIVE_MESSAGE_DISCRIMINATOR);
  assert.equal(data.length, 8 + 4 + 376 + 4 + 130);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(view.getUint32(8, true), 376, "message length is a little-endian u32");
  assert.equal(view.getUint32(12 + 376, true), 130, "attestation length follows the message");
});

test("malformed hexadecimal never becomes an instruction", function () {
  assert.throws(() => encodeReceiveMessageData("0xabc", `0x${"11".repeat(65)}`), /whole-byte hexadecimal/);
  assert.throws(() => encodeReceiveMessageData(`0x${"00".repeat(376)}`, "0xzz"), /whole-byte hexadecimal/);
});

test("a nonce or remote token of the wrong length is refused before any address is derived", async function () {
  await assert.rejects(
    deriveCctpReceiveAccounts({ sourceDomain: 0, remoteTokenHex: LIVE.remoteTokenHex, nonce: "0xdead" }),
    /thirty-two bytes/,
  );
  await assert.rejects(
    deriveCctpReceiveAccounts({ sourceDomain: 0, remoteTokenHex: "0xa0b8", nonce: LIVE.nonce }),
    /thirty-two bytes/,
  );
});

/**
 * The fee account, read from chain state.
 *
 * Circle's fee recipient is a field inside the `TokenMessenger` account rather
 * than a published address, and a replay that names the wrong one reverts after
 * the money has already been burned on the other chain. The offset below is the
 * one the live account uses.
 */
test("the fee recipient is read out of the token messenger at the offset the chain uses", function () {
  const account = new Uint8Array(177);
  const owner = new Uint8Array(32).fill(9);
  account.set(owner, TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET);
  assert.equal(readTokenMessengerFeeRecipient(account), base58Encode(owner));

  /* Anything shorter than the field is unreadable rather than partly right. */
  assert.equal(readTokenMessengerFeeRecipient(new Uint8Array(120)), null);
});

test("the replay account's size is the one its rent was computed from", function () {
  /* Solana's rent-exempt minimum is `(128 + size) × 6960`. The live account
     holds 953,520 lamports, which is exactly nine bytes. */
  assert.equal((128 + CCTP_USED_NONCE_ACCOUNT_BYTES) * 6960, 953_520);
});
