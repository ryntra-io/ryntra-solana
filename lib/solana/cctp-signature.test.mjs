import assert from "node:assert/strict";
import test from "node:test";

import * as ed from "@noble/ed25519";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { createHash } from "node:crypto";

import {
  anyDestinationCaller,
  buildCctpBurnInstruction,
  CCTP_FINALITY_THRESHOLD,
  evmMintRecipient,
} from "./cctp-burn.ts";
import { addEphemeralSignature, encodeBase58 } from "./cctp-ephemeral.client.ts";
import { checkCctpSignedBurn, checkCctpWalletSignature } from "./cctp-signature.ts";
import { associatedTokenAccount } from "./token-account.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/* A real mainnet blockhash shape. Any valid 32-byte base58 value compiles. */
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

async function keypair() {
  const secret = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(secret);
  return { secret, address: encodeBase58(publicKey), sign: (message) => ed.signAsync(message, secret) };
}

/** A real compiled burn, and the minimum plan the checks read. */
async function buildBurn() {
  const owner = await keypair();
  const ephemeral = await keypair();
  const burnTokenAccount = await associatedTokenAccount({ owner: owner.address, mint: USDC, tokenProgram: TOKEN_PROGRAM });
  const instruction = await buildCctpBurnInstruction({
    owner: owner.address,
    rentPayer: owner.address,
    burnTokenAccount,
    messageSentAccount: ephemeral.address,
    amountRaw: "2000000",
    destinationDomain: 6,
    mintRecipient: evmMintRecipient("0x152d117c0cfdd2e807a4e7cc4d839da9586ec401"),
    destinationCaller: anyDestinationCaller(),
    maxFeeRaw: "0",
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(owner.address, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, draft),
    (draft) => appendTransactionMessageInstructions([instruction], draft),
  );
  const compiled = compileTransaction(message);
  const messageBytes = compiled.messageBytes;
  const unsignedWireBase64 = getBase64EncodedWireTransaction(compiled);
  const plan = {
    owner: owner.address,
    messageSentAccount: ephemeral.address,
    /* The comparator reads the reviewed bytes, not only their hash: it has to
       decode both sides to tell an added guard from a changed transfer. */
    unsignedWireBase64,
    fingerprint: {
      messageHash: `0x${createHash("sha256").update(messageBytes).digest("hex")}`,
      feePayer: owner.address,
      blockhash: BLOCKHASH,
      instructionCount: 1,
      signers: [owner.address, ephemeral.address],
    },
  };
  return { owner, ephemeral, plan, compiled, messageBytes, unsignedWireBase64 };
}

/** What a wallet does: fill its own slot and nothing else. */
async function walletSign(built) {
  const decoded = getTransactionDecoder().decode(Buffer.from(built.unsignedWireBase64, "base64"));
  const signature = await built.owner.sign(decoded.messageBytes);
  const wire = getTransactionEncoder().encode({
    ...decoded,
    signatures: { ...decoded.signatures, [built.owner.address]: signature },
  });
  return Buffer.from(wire).toString("base64");
}

const ephemeralAccount = (built) => ({
  address: built.ephemeral.address,
  sign: built.ephemeral.sign,
  discard: () => {},
});

test("a real burn requires exactly the owner and the message account to sign", async () => {
  const built = await buildBurn();
  const decoded = getTransactionDecoder().decode(Buffer.from(built.unsignedWireBase64, "base64"));
  assert.deepEqual(Object.keys(decoded.signatures).sort(), [...built.plan.fingerprint.signers].sort());
  assert.equal(Object.keys(decoded.signatures).length, 2, "one wallet prompt and one browser-local signature");
});

test("wallet first, then the ephemeral key, and the result clears", async () => {
  const built = await buildBurn();
  const walletSigned = await walletSign(built);

  /* Between the two steps the wallet's half already verifies on its own. */
  const half = checkCctpWalletSignature({ plan: built.plan, signedWireBase64: walletSigned });
  assert.equal(half.verdict, "CLEARED");
  assert.equal(half.signature, null, "the transaction id is not claimed until both signatures exist");

  const completed = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: walletSigned,
    account: ephemeralAccount(built),
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) return;
  assert.equal(completed.messageHash, built.plan.fingerprint.messageHash);

  const full = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: completed.signedWireBase64 });
  assert.equal(full.verdict, "CLEARED", full.detail);
  assert.ok(full.signature);
});

test("filling the empty slot changes nothing but the empty slot", async () => {
  const built = await buildBurn();
  const walletSigned = await walletSign(built);
  const before = getTransactionDecoder().decode(Buffer.from(walletSigned, "base64"));
  const completed = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: walletSigned,
    account: ephemeralAccount(built),
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) return;
  const after = getTransactionDecoder().decode(Buffer.from(completed.signedWireBase64, "base64"));

  assert.deepEqual(
    Buffer.from(after.messageBytes).toString("base64"),
    Buffer.from(before.messageBytes).toString("base64"),
    "the message the wallet signed is byte-identical afterwards",
  );
  assert.deepEqual(
    Buffer.from(after.signatures[built.owner.address]).toString("base64"),
    Buffer.from(before.signatures[built.owner.address]).toString("base64"),
    "the wallet's own signature is untouched",
  );
  const emptyBefore = before.signatures[built.ephemeral.address];
  assert.ok(emptyBefore === null || emptyBefore.every((byte) => byte === 0), "the slot was empty before");
  assert.ok(after.signatures[built.ephemeral.address].some((byte) => byte !== 0), "and is filled after");
});

test("a message the wallet altered is refused before this tab's key touches it", async () => {
  const built = await buildBurn();
  const other = await buildBurn();
  const walletSigned = await walletSign(other);

  const completed = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: walletSigned,
    account: ephemeralAccount(built),
  });
  assert.equal(completed.ok, false);
  if (completed.ok) return;
  assert.equal(completed.code, "BYTES_CHANGED");
  assert.match(completed.reason, /Nothing was signed here/);
});

test("the server refuses a changed message too, and names it a new Review", async () => {
  const built = await buildBurn();
  const other = await buildBurn();
  const otherSigned = await walletSign(other);
  const completedOther = await addEphemeralSignature({
    plan: other.plan,
    signedWireBase64: otherSigned,
    account: ephemeralAccount(other),
  });
  assert.equal(completedOther.ok, true);
  if (!completedOther.ok) return;

  const check = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: completedOther.signedWireBase64 });
  assert.equal(check.verdict, "UNREVIEWED_CHANGE");
  assert.match(check.detail, /Return to Review and build a fresh transfer/);
});

test("an unsigned transaction is missing the owner's signature, not merely unreadable", async () => {
  const built = await buildBurn();
  const check = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: built.unsignedWireBase64 });
  assert.equal(check.verdict, "OWNER_SIGNATURE_MISSING");
});

test("the wallet's signature alone is not enough to submit", async () => {
  const built = await buildBurn();
  const walletSigned = await walletSign(built);
  const check = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: walletSigned });
  assert.equal(check.verdict, "MESSAGE_SIGNATURE_MISSING");
  assert.equal(check.signature, null);
});

test("a forged ephemeral signature does not verify over the reviewed bytes", async () => {
  const built = await buildBurn();
  const impostor = await keypair();
  const walletSigned = await walletSign(built);
  const decoded = getTransactionDecoder().decode(Buffer.from(walletSigned, "base64"));
  /* A real signature by the wrong key, written into the right slot. */
  const wrong = await impostor.sign(decoded.messageBytes);
  const wire = getTransactionEncoder().encode({
    ...decoded,
    signatures: { ...decoded.signatures, [built.ephemeral.address]: wrong },
  });
  const check = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: Buffer.from(wire).toString("base64") });
  assert.equal(check.verdict, "MESSAGE_SIGNATURE_INVALID");
});

test("a slot that is already filled is never overwritten", async () => {
  const built = await buildBurn();
  const walletSigned = await walletSign(built);
  const once = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: walletSigned,
    account: ephemeralAccount(built),
  });
  assert.equal(once.ok, true);
  if (!once.ok) return;
  const twice = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: once.signedWireBase64,
    account: ephemeralAccount(built),
  });
  assert.equal(twice.ok, false);
  if (twice.ok) return;
  assert.equal(twice.code, "SLOT_NOT_EMPTY");
});

test("the ephemeral key refuses to sign once it is discarded", async () => {
  const built = await buildBurn();
  const account = ephemeralAccount(built);
  const live = { ...account };
  let secret = ed.utils.randomPrivateKey();
  const guarded = {
    address: account.address,
    sign: async (message) => {
      if (!secret) throw new Error("The message account key has already been discarded.");
      return live.sign(message);
    },
    discard: () => {
      secret = null;
    },
  };
  guarded.discard();
  await assert.rejects(() => guarded.sign(new Uint8Array(8)), /already been discarded/);
});

test("an unreadable reply is unreadable, never a silent pass", async () => {
  const built = await buildBurn();
  const check = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: "bm90LWEtdHJhbnNhY3Rpb24=" });
  assert.equal(check.verdict, "UNREADABLE");
  assert.equal(check.signature, null);
});

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

/** What Phantom actually does: prepend a unit limit and a unit price. */
function computeBudgetInstructions() {
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, 200_000, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, 1_000n, true);
  return [
    { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data: limit },
    { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data: price },
  ];
}

/** The same burn with the wallet's guards prepended, as a wallet returns it. */
async function buildBurnWithWalletGuards(built) {
  const instruction = await buildCctpBurnInstruction({
    owner: built.owner.address,
    rentPayer: built.owner.address,
    burnTokenAccount: await associatedTokenAccount({
      owner: built.owner.address,
      mint: USDC,
      tokenProgram: TOKEN_PROGRAM,
    }),
    messageSentAccount: built.ephemeral.address,
    amountRaw: "2000000",
    destinationDomain: 6,
    mintRecipient: evmMintRecipient("0x152d117c0cfdd2e807a4e7cc4d839da9586ec401"),
    destinationCaller: anyDestinationCaller(),
    maxFeeRaw: "0",
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(built.owner.address, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, draft),
    (draft) => appendTransactionMessageInstructions([...computeBudgetInstructions(), instruction], draft),
  );
  const compiled = compileTransaction(message);
  const decoded = getTransactionDecoder().decode(Buffer.from(getBase64EncodedWireTransaction(compiled), "base64"));
  const signature = await built.owner.sign(decoded.messageBytes);
  const wire = getTransactionEncoder().encode({
    ...decoded,
    signatures: { ...decoded.signatures, [built.owner.address]: signature },
  });
  return Buffer.from(wire).toString("base64");
}

test("a wallet that adds its own compute budget is accepted, and the lane says so", async () => {
  /* The production failure this pins. The first version compared message
     hashes, so Phantom's own priority-fee instructions — which change the
     bytes and change nothing about the transfer — refused every real
     signature after the person had already approved it in the wallet. */
  const built = await buildBurn();
  const walletSigned = await buildBurnWithWalletGuards(built);

  const completed = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: walletSigned,
    account: ephemeralAccount(built),
  });
  assert.equal(completed.ok, true, completed.ok ? "" : completed.reason);
  if (!completed.ok) return;
  assert.equal(completed.lane, "WALLET_GUARDS_ONLY");
  assert.deepEqual(completed.addedPrograms, [COMPUTE_BUDGET_PROGRAM]);
  assert.notEqual(completed.messageHash, built.plan.fingerprint.messageHash, "the bytes did move");

  const full = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: completed.signedWireBase64 });
  assert.equal(full.verdict, "CLEARED", full.detail);
  assert.equal(full.lane, "WALLET_GUARDS_ONLY");
  assert.deepEqual(full.addedPrograms, [COMPUTE_BUDGET_PROGRAM]);
  assert.equal(full.signedMessageHash, completed.messageHash);
  assert.ok(full.signature);
});

test("an added program that is not a wallet guard is still a full stop", async () => {
  const built = await buildBurn();
  const stranger = await keypair();
  const instruction = await buildCctpBurnInstruction({
    owner: built.owner.address,
    rentPayer: built.owner.address,
    burnTokenAccount: await associatedTokenAccount({
      owner: built.owner.address,
      mint: USDC,
      tokenProgram: TOKEN_PROGRAM,
    }),
    messageSentAccount: built.ephemeral.address,
    amountRaw: "2000000",
    destinationDomain: 6,
    mintRecipient: evmMintRecipient("0x152d117c0cfdd2e807a4e7cc4d839da9586ec401"),
    destinationCaller: anyDestinationCaller(),
    maxFeeRaw: "0",
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(built.owner.address, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, draft),
    (draft) =>
      appendTransactionMessageInstructions(
        [instruction, { programAddress: stranger.address, accounts: [], data: new Uint8Array([1]) }],
        draft,
      ),
  );
  const compiled = compileTransaction(message);
  const wire = getBase64EncodedWireTransaction(compiled);
  const completed = await addEphemeralSignature({
    plan: built.plan,
    signedWireBase64: wire,
    account: ephemeralAccount(built),
  });
  assert.equal(completed.ok, false);
  if (completed.ok) return;
  assert.equal(completed.code, "BYTES_CHANGED");
  assert.match(completed.reason, /unreviewed program|no longer match Review/);
});

const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** Shaped exactly like the assertions Phantom wrote on the Send that landed. */
function lighthouse(kind, account, length) {
  const data = new Uint8Array(length);
  data[0] = kind;
  data[1] = 4;
  data[2] = kind === 6 ? 3 : 4;
  return {
    programAddress: LIGHTHOUSE_PROGRAM,
    accounts: [{ address: account, role: 1 }],
    data,
  };
}

test("a burn changes three balances, and the wallet may assert on all of them", async () => {
  /* Phantom writes one Lighthouse assertion per thing it can check. A transfer
     changes two balances and gets the pair Send was written around; a burn
     moves the owner's lamports and token balance and creates a funded message
     account that is itself a signer, so it gets more — including a second
     account-info assertion, which the Send-shaped rule rejects as a duplicate.
     An assertion can only make a transaction fail; it moves nothing. */
  const built = await buildBurn();
  const burnTokenAccount = await associatedTokenAccount({
    owner: built.owner.address,
    mint: USDC,
    tokenProgram: TOKEN_PROGRAM,
  });
  const instruction = await buildCctpBurnInstruction({
    owner: built.owner.address,
    rentPayer: built.owner.address,
    burnTokenAccount,
    messageSentAccount: built.ephemeral.address,
    amountRaw: "2000000",
    destinationDomain: 6,
    mintRecipient: evmMintRecipient("0x152d117c0cfdd2e807a4e7cc4d839da9586ec401"),
    destinationCaller: anyDestinationCaller(),
    maxFeeRaw: "0",
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(built.owner.address, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, draft),
    (draft) =>
      appendTransactionMessageInstructions(
        [
          ...computeBudgetInstructions(),
          instruction,
          lighthouse(6, built.owner.address, 26),
          lighthouse(6, built.ephemeral.address, 26),
          lighthouse(10, burnTokenAccount, 27),
        ],
        draft,
      ),
  );
  const compiled = compileTransaction(message);
  const decoded = getTransactionDecoder().decode(Buffer.from(getBase64EncodedWireTransaction(compiled), "base64"));
  const signature = await built.owner.sign(decoded.messageBytes);
  const wire = Buffer.from(
    getTransactionEncoder().encode({ ...decoded, signatures: { ...decoded.signatures, [built.owner.address]: signature } }),
  ).toString("base64");

  const completed = await addEphemeralSignature({ plan: built.plan, signedWireBase64: wire, account: ephemeralAccount(built) });
  assert.equal(completed.ok, true, completed.ok ? "" : completed.reason);
  if (!completed.ok) return;
  assert.equal(completed.lane, "WALLET_GUARDS_ONLY");

  const full = checkCctpSignedBurn({ plan: built.plan, signedWireBase64: completed.signedWireBase64 });
  assert.equal(full.verdict, "CLEARED", full.detail);
  assert.deepEqual([...full.addedPrograms].sort(), [COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM].sort());
});
