import assert from "node:assert/strict";
import test from "node:test";

import {
  anyDestinationCaller,
  buildCctpBurnInstruction,
  cctpBurnIntentDigest,
  CCTP_FINALITY_THRESHOLD,
  deriveCctpBurnAccounts,
  DEPOSIT_FOR_BURN_DISCRIMINATOR,
  encodeDepositForBurnData,
  evmMintRecipient,
} from "./cctp-burn.ts";

/**
 * One real mainnet burn, used as the specification.
 *
 * Circle publishes no IDL for these programs and the argument order, the
 * account order and the seed encodings are not all written down anywhere this
 * repository could cite. So the encoder was built against
 * `2BjZydKP6jodxApPYgTkuEUSgZmSNrX2N38Y7FisrryN8wGPRAqNBj2Yb9grdkPusVRkMjfvAmri6QbTTUHW8jxA`
 * — finalized on Solana mainnet, 90.059472 USDC to Ethereum — and this test
 * reproduces it byte for byte and address for address.
 *
 * That makes the test a regression against Circle as much as against us: a
 * redeployed program or a changed account order fails here, on the exact field
 * that moved, rather than on a signed transaction the founder is holding.
 */
const LIVE = Object.freeze({
  owner: "BZrYLNA8NsHb92YvJPoUKQe13ds5EHCpVa5j2QMUSQRD",
  rentPayer: "Cc5M6mecyBKjdrjnvreuANqhMBdLeU7RZNzoSEh2Rnfc",
  burnTokenAccount: "2jgH4gSzbkGetnKQWmGNMFZN7mrFwJx34T4sQu9jH87m",
  messageSentAccount: "2CNctSwdSpfFEFvzUe9nx2i6PhKH6HBQ8uKKoLJYWYAp",
  amountRaw: "90059472",
  destinationDomain: 0,
  mintRecipientEvm: "0xcac07b537ea5b6fabf84794976355caa1805b5d0",
  maxFeeRaw: "10808",
  minFinalityThreshold: 1000,
  dataHex:
    "d73c3d2e723780b0" +
    "d0325e0500000000" +
    "00000000" +
    "000000000000000000000000cac07b537ea5b6fabf84794976355caa1805b5d0" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "382a000000000000" +
    "e8030000",
  accounts: [
    "BZrYLNA8NsHb92YvJPoUKQe13ds5EHCpVa5j2QMUSQRD",
    "Cc5M6mecyBKjdrjnvreuANqhMBdLeU7RZNzoSEh2Rnfc",
    "45hzrGLQ2EGo1Ln7QpXjDwb589GDQ9H2aEXXw6ds6BFE",
    "2jgH4gSzbkGetnKQWmGNMFZN7mrFwJx34T4sQu9jH87m",
    "E5M9ELEKThv3GZpj28zR2BRBXhLUbNbp9Lf1pc7tLgbb",
    "W1k5ijkaSTo5iA5zChNpfzcy796fLhkBxfmJuR8W8HU",
    "AawthJCGRmggpfv9MMWV6Jmo9cue4gL9wUZgRBShg58W",
    "3EzN2mcmdfSNGXRCAixSpTteK6ywdmFDZZWvkMnznFt9",
    "E1bQJ8eMMn3zmeSewW3HQ8zmJr7KR75JonbwAtWx2bux",
    "CRBBbuLCyrkQy4dCTHxqstSmDQv4ajBeUVb9qUdMVaP1",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "2CNctSwdSpfFEFvzUe9nx2i6PhKH6HBQ8uKKoLJYWYAp",
    "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "11111111111111111111111111111111",
    "6TCCnJ9R1m1RXFzyoH7GYH2J6NJDtZaUvfipPuLWxHNd",
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  ],
});

function liveIntent(overrides = {}) {
  return {
    direction: "SOLANA_TO_BASE",
    sourceDomain: 5,
    owner: LIVE.owner,
    rentPayer: LIVE.rentPayer,
    burnTokenAccount: LIVE.burnTokenAccount,
    messageSentAccount: LIVE.messageSentAccount,
    amountRaw: LIVE.amountRaw,
    destinationDomain: LIVE.destinationDomain,
    mintRecipient: evmMintRecipient(LIVE.mintRecipientEvm),
    destinationCaller: anyDestinationCaller(),
    maxFeeRaw: LIVE.maxFeeRaw,
    minFinalityThreshold: LIVE.minFinalityThreshold,
    ...overrides,
  };
}

test("the encoder reproduces a real mainnet burn byte for byte", function () {
  const data = encodeDepositForBurnData(liveIntent());
  assert.equal(Buffer.from(data).toString("hex"), LIVE.dataHex);
  assert.equal(data.length, 96);
  assert.equal(Buffer.from(data.subarray(0, 8)).toString("hex"), DEPOSIT_FOR_BURN_DISCRIMINATOR);
});

/**
 * The seed that would have been wrong.
 *
 * `remote_token_messenger` takes the destination domain as an ASCII string.
 * A `u32` encoding derives a different, entirely valid-looking address that the
 * program rejects — and nothing in the argument list hints at it.
 */
test("every account is derived, and the domain seed is ASCII rather than a u32", async function () {
  const accounts = await deriveCctpBurnAccounts({ owner: LIVE.owner, destinationDomain: 0 });
  assert.equal(accounts.senderAuthority, LIVE.accounts[2]);
  assert.equal(accounts.denylistAccount, LIVE.accounts[4]);
  assert.equal(accounts.messageTransmitter, LIVE.accounts[5]);
  assert.equal(accounts.tokenMessenger, LIVE.accounts[6]);
  assert.equal(accounts.remoteTokenMessenger, LIVE.accounts[7]);
  assert.equal(accounts.tokenMinter, LIVE.accounts[8]);
  assert.equal(accounts.localToken, LIVE.accounts[9]);
  assert.equal(accounts.eventAuthority, LIVE.accounts[16]);

  /* A different domain must derive a different remote messenger, or the seed
     is not doing its job. */
  const base = await deriveCctpBurnAccounts({ owner: LIVE.owner, destinationDomain: 6 });
  assert.notEqual(base.remoteTokenMessenger, accounts.remoteTokenMessenger);
  /* Everything not keyed on the domain must be identical. */
  assert.equal(base.tokenMessenger, accounts.tokenMessenger);
  assert.equal(base.localToken, accounts.localToken);
});

test("the instruction places all eighteen accounts where the program expects them", async function () {
  const instruction = await buildCctpBurnInstruction(liveIntent());
  assert.equal(String(instruction.programAddress), "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
  assert.deepEqual(instruction.accounts.map((entry) => String(entry.address)), LIVE.accounts);
  assert.equal(Buffer.from(instruction.data).toString("hex"), LIVE.dataHex);

  /* Three signer positions — owner, rent payer, and the ephemeral event
     account. The reference burn used a separate rent payer, so it carried three
     distinct signatures; when the owner pays their own rent the positions
     collapse to two keys. Either way the ephemeral account is a signer, and
     that is the fact the Review has to explain rather than let the wallet
     spring on somebody mid-signature. */
  const signers = instruction.accounts.filter((entry) => entry.role === 2 || entry.role === 3);
  assert.deepEqual(
    signers.map((entry) => String(entry.address)),
    [LIVE.owner, LIVE.rentPayer, LIVE.messageSentAccount],
  );

  const ownPayer = await buildCctpBurnInstruction(liveIntent({ rentPayer: LIVE.owner }));
  const ownSigners = new Set(
    ownPayer.accounts.filter((entry) => entry.role === 2 || entry.role === 3).map((entry) => String(entry.address)),
  );
  assert.deepEqual([...ownSigners], [LIVE.owner, LIVE.messageSentAccount]);
});

test("an EVM recipient is left-padded and a malformed one is refused", function () {
  const padded = evmMintRecipient("0xcac07b537ea5b6fabf84794976355caa1805b5d0");
  assert.equal(padded.length, 32);
  assert.ok(padded.subarray(0, 12).every((byte) => byte === 0));
  assert.equal(Buffer.from(padded.subarray(12)).toString("hex"), "cac07b537ea5b6fabf84794976355caa1805b5d0");

  for (const bad of ["0xcac0", "cac07b537ea5b6fabf84794976355caa1805b5d0z", "", "0x"]) {
    assert.throws(() => evmMintRecipient(bad), /Not a 20-byte EVM address/);
  }
  assert.deepEqual([...anyDestinationCaller()], new Array(32).fill(0));
});

test("a recipient that is not exactly 32 bytes never becomes an instruction", function () {
  assert.throws(
    () => encodeDepositForBurnData(liveIntent({ mintRecipient: new Uint8Array(20) })),
    /mintRecipient must be 32 bytes/,
  );
  assert.throws(
    () => encodeDepositForBurnData(liveIntent({ destinationCaller: new Uint8Array(31) })),
    /destinationCaller must be 32 bytes/,
  );
});

/**
 * The duplicate-burn key.
 *
 * Canon §25.5 forbids a second burn under any failure, and the Send path's
 * boundary cannot enforce that: it keys on a signature, so a freshly built burn
 * of the same intent — new blockhash, new ephemeral account — is invisible to
 * it. The digest below is what makes two burns the same burn.
 */
test("the intent digest ignores what may change and catches what may not", function () {
  const base = cctpBurnIntentDigest(liveIntent());
  assert.match(base, /^0x[0-9a-f]{64}$/);

  /* A rebuild changes these and is still the same burn. */
  for (const overrides of [
    { messageSentAccount: "11111111111111111111111111111111" },
    { rentPayer: "11111111111111111111111111111111" },
    { maxFeeRaw: "999999" },
    { destinationCaller: new Uint8Array(32).fill(7) },
  ]) {
    assert.equal(cctpBurnIntentDigest(liveIntent(overrides)), base);
  }

  /* These make it a different burn, and every one of them is money. */
  for (const overrides of [
    { amountRaw: "90059473" },
    { destinationDomain: 6 },
    { mintRecipient: evmMintRecipient("0x0000000000000000000000000000000000000001") },
    { owner: "11111111111111111111111111111111" },
    { burnTokenAccount: "11111111111111111111111111111111" },
    { minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD },
  ]) {
    assert.notEqual(cctpBurnIntentDigest(liveIntent(overrides)), base);
  }
});

/**
 * The other half of the same property, and the one the reverse lane needed.
 *
 * A Base-source transfer and a Solana-source transfer can agree on every field
 * the first version of this digest covered — the same person, the same amount,
 * the same finality — and still be two different transfers going opposite ways.
 * A digest blind to that would have made one of them look like a duplicate of
 * the other in the durable store, and refused it.
 */
test("two directions of the same amount are never the same burn", function () {
  const forward = cctpBurnIntentDigest(liveIntent());
  const reverse = cctpBurnIntentDigest(liveIntent({ direction: "BASE_TO_SOLANA", sourceDomain: 6 }));
  assert.notEqual(forward, reverse);

  /* And the direction alone is enough, even with identical domains, so a lane
     that forgot to move the domain does not silently collide either. */
  assert.notEqual(cctpBurnIntentDigest(liveIntent({ direction: "BASE_TO_SOLANA" })), forward);
});

test("the M3 canary shape encodes exactly what the card records", async function () {
  const intent = {
    owner: "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n",
    rentPayer: "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n",
    burnTokenAccount: "5XmJVGx1jLPPZd95WjtSni8fjQ6QKgmmZikAumxmwxXD",
    messageSentAccount: "2CNctSwdSpfFEFvzUe9nx2i6PhKH6HBQ8uKKoLJYWYAp",
    amountRaw: "2000000",
    destinationDomain: 6,
    mintRecipient: evmMintRecipient("0x152d117c0cfdd2e807a4e7cc4d839da9586ec401"),
    destinationCaller: anyDestinationCaller(),
    maxFeeRaw: "0",
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
  };
  const data = encodeDepositForBurnData(intent);
  const hex = Buffer.from(data).toString("hex");

  assert.equal(hex.slice(0, 16), DEPOSIT_FOR_BURN_DISCRIMINATOR);
  assert.equal(Buffer.from(data.subarray(8, 16)).readBigUInt64LE(0), 2_000_000n);
  assert.equal(Buffer.from(data.subarray(16, 20)).readUInt32LE(0), 6);
  assert.equal(
    Buffer.from(data.subarray(20, 52)).toString("hex"),
    "000000000000000000000000152d117c0cfdd2e807a4e7cc4d839da9586ec401",
  );
  assert.ok(data.subarray(52, 84).every((byte) => byte === 0), "anyone may complete the mint");
  assert.equal(Buffer.from(data.subarray(84, 92)).readBigUInt64LE(0), 0n, "Standard is quoted at zero");
  assert.equal(Buffer.from(data.subarray(92, 96)).readUInt32LE(0), 2000, "Standard finality threshold");

  const instruction = await buildCctpBurnInstruction(intent);
  assert.equal(instruction.accounts.length, 18);
  assert.equal(String(instruction.accounts[3].address), "5XmJVGx1jLPPZd95WjtSni8fjQ6QKgmmZikAumxmwxXD");
  assert.equal(String(instruction.accounts[10].address), "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
});
