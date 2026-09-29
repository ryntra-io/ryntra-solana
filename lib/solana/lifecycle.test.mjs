/**
 * The build-and-signature half of the devnet lifecycle, proven without a
 * wallet and without a network.
 *
 * A real wallet is a browser extension the founder controls, and waiting for
 * one to test this would mean the gate that protects the signature is the one
 * part never exercised. So the test *is* a wallet: a throwaway Ed25519 key
 * signs the exact message bytes the builder produced, which is precisely what
 * Phantom or Solflare does with the founder's key. Everything the check can
 * say — cleared, bytes changed, signature invalid, missing, unreadable — is
 * reached here.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import { getTransferCheckedWithFeeInstructionDataDecoder } from "@solana-program/token-2022";

import { checkReturnedBytes } from "./fingerprint.client.ts";

import { SPL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";
import { decodeRawMintAccount } from "./mint.ts";
import { buildPassport } from "./passport.ts";
import { createSolanaRpcHandle } from "./rpc.ts";
import { checkSignedTransfer } from "./signature.ts";
import { associatedTokenAccount, buildTransferTransaction } from "./transaction.ts";
import { needsDevelopmentRepository } from "../development-repository.mjs";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

/** A throwaway wallet: an Ed25519 key that exists for one test run. */
function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    address: getAddressDecoder().decode(new Uint8Array(raw)),
    sign: (message) => new Uint8Array(signBytes(null, Buffer.from(message), privateKey)),
  };
}

/* On the ed25519 curve, so it can own an associated token account. The older
   fixture `5Q544fKrFoe6…pge4j1` is off-curve and is now refused before a
   transfer is built, which is the recipient resolver working rather than a
   regression. */
const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

/**
 * Serve the four reads the builder makes, by method, from captured bytes.
 * Only the transport is fake — the decoder, the passport, the PDA derivation
 * and the compiler are all the real ones.
 */
function stubRpc({
  mint,
  senderBalance = "5000000",
  recipientExists = false,
  senderMissing = false,
  blockhashFails = false,
  baseFeeLamports = 5_000,
  ataRentLamports = 2_039_280,
  feePayerBalanceLamports = 5_000_000_000,
}) {
  const original = globalThis.fetch;
  const seen = [];
  const rentExemptionSpaces = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.method);
    const reply = (result) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const error = (message) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    switch (body.method) {
      case "getAccountInfo": {
        /* By address now, not one answer for every read. The builder asks
           about three different things — the mint, the recipient's wallet and
           the recipient's token account — and answering "here is the mint" to
           all three made the recipient look like a token-program account of
           the wrong shape. */
        const [queried] = body.params;
        if (queried === RECIPIENT) {
          return reply({
            context: { apiVersion: "2.1.0", slot: Number(mint.slot) },
            value: {
              data: ["", "base64"],
              executable: false,
              lamports: 1_000_000,
              owner: SYSTEM_PROGRAM,
              rentEpoch: 0,
              space: 0,
            },
          });
        }
        if (queried === stubRpc.recipientAta) {
          if (!recipientExists) return reply({ context: { apiVersion: "2.1.0", slot: 1 }, value: null });
          return reply({
            context: { apiVersion: "2.1.0", slot: 1 },
            value: {
              data: {
                program: "spl-token",
                parsed: {
                  type: "account",
                  info: { mint: mint.mint, owner: RECIPIENT, state: "initialized" },
                },
              },
              executable: false,
              lamports: 2_039_280,
              owner: mint.owner,
              rentEpoch: 0,
              space: 165,
            },
          });
        }
        return reply({
          context: { apiVersion: "2.1.0", slot: Number(mint.slot) },
          value: {
            data: [mint.dataBase64, "base64"],
            executable: false,
            lamports: 1_000_000,
            owner: mint.owner,
            rentEpoch: 0,
            space: 0,
          },
        });
      }
      case "getTokenAccountBalance": {
        const account = body.params[0];
        const isRecipient = account === stubRpc.recipientAta;
        if (isRecipient && !recipientExists) return error("could not find account");
        if (!isRecipient && senderMissing) return error("could not find account");
        return reply({
          context: { apiVersion: "2.1.0", slot: 1 },
          value: { amount: isRecipient ? "0" : senderBalance, decimals: 6, uiAmountString: "0" },
        });
      }
      case "getLatestBlockhash":
        if (blockhashFails) return error("node is behind");
        return reply({
          context: { apiVersion: "2.1.0", slot: 1 },
          value: { blockhash: BLOCKHASH, lastValidBlockHeight: 350_000_000 },
        });
      case "getFeeForMessage":
        return reply({ context: { apiVersion: "2.1.0", slot: 1 }, value: baseFeeLamports });
      case "getMinimumBalanceForRentExemption":
        rentExemptionSpaces.push(String(body.params[0]));
        return reply(ataRentLamports);
      case "getBalance":
        return reply({ context: { apiVersion: "2.1.0", slot: 1 }, value: feePayerBalanceLamports });
      default:
        return error(`unstubbed method ${body.method}`);
    }
  };
  return { restore: () => { globalThis.fetch = original; }, seen, rentExemptionSpaces };
}

async function buildOne(overrides = {}) {
  const wallet = overrides.wallet ?? testWallet();
  const raw = fixture(overrides.fixture ?? "usdc-spl");
  const devnetRaw = { ...raw, network: "devnet" };
  const read = decodeRawMintAccount(devnetRaw);
  assert.equal(read.ok, true);
  const passport = buildPassport(devnetRaw);
  assert.equal(passport.ok, true);

  stubRpc.recipientAta = await associatedTokenAccount({
    owner: RECIPIENT,
    mint: devnetRaw.mint,
    tokenProgram: passport.passport.identity.programId,
  });
  const stub = stubRpc({ mint: devnetRaw, ...overrides });
  try {
    const result = await buildTransferTransaction({
      handle: createSolanaRpcHandle({ network: "devnet" }),
      read,
      passport: passport.passport,
      epoch: overrides.epoch ?? 250n,
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: "devnet",
        mint: devnetRaw.mint,
        sender: String(wallet.address),
        recipient: RECIPIENT,
        amountRaw: overrides.amountRaw ?? "1000000",
      },
    });
    return { result, wallet, seen: stub.seen, rentExemptionSpaces: stub.rentExemptionSpaces };
  } finally {
    stub.restore();
  }
}

/** Sign the plan's bytes the way a wallet does, and re-encode the transaction. */
function walletSign(plan, wallet) {
  const decoded = getTransactionDecoder().decode(Buffer.from(plan.unsignedWireBase64, "base64"));
  const signed = {
    messageBytes: decoded.messageBytes,
    signatures: { ...decoded.signatures, [wallet.address]: wallet.sign(decoded.messageBytes) },
  };
  return Buffer.from(getTransactionEncoder().encode(signed)).toString("base64");
}

test("the built transfer carries the exact accounts, amount and decimals it was asked for", async function () {
  const { result, wallet } = await buildOne();
  assert.equal(result.ok, true);
  const { plan } = result;

  assert.equal(plan.network, "devnet");
  assert.equal(plan.sender, String(wallet.address));
  assert.equal(plan.recipient, RECIPIENT);
  assert.equal(plan.amountRaw, "1000000");
  assert.equal(plan.decimals, 6);
  assert.equal(plan.blockhash, BLOCKHASH);
  assert.equal(plan.createsRecipientAccount, true);
  assert.equal(plan.baseFeeLamports, "5000");
  assert.equal(plan.priorityFeeLamports, "0");
  assert.equal(plan.ataRentLamports, "2039280");
  assert.equal(plan.programs.includes(plan.tokenProgram), true);
  /* Two instructions: create the recipient's account, then transfer. */
  assert.equal(plan.fingerprint.instructionCount, 2);
  assert.equal(plan.fingerprint.transfer.amountRaw, "1000000");
  assert.equal(plan.fingerprint.transfer.decimals, 6);
  assert.match(plan.fingerprint.messageHash, /^0x[0-9a-f]{64}$/);
  assert.ok(plan.unsignedWireBase64.length > 0);
});

test("the token builder refuses when the fee payer cannot cover base fee plus ATA rent", async () => {
  const { result } = await buildOne({
    recipientExists: false,
    baseFeeLamports: 5_000,
    ataRentLamports: 2_039_280,
    feePayerBalanceLamports: 2_044_279,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INSUFFICIENT_FEE_BALANCE");
});

test("a Token-2022 transfer-fee mint binds the rounded fee into its fee-aware instruction", async () => {
  const { result } = await buildOne({ fixture: "bern-t22", amountRaw: "1" });
  assert.equal(result.ok, true);
  const transaction = getTransactionDecoder().decode(Buffer.from(result.plan.unsignedWireBase64, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const transfer = message.instructions.find(
    (instruction) => String(message.staticAccounts[instruction.programAddressIndex]) === result.plan.tokenProgram,
  );
  assert.ok(transfer, "the built message contains the token-program transfer");
  const decoded = getTransferCheckedWithFeeInstructionDataDecoder().decode(transfer.data);
  assert.equal(decoded.amount, 1n);
  assert.equal(decoded.fee, 1n, "the program-visible expected fee is rounded up");
});

test("Token-2022 recipient rent is priced from its required extended account size, not 165 bytes", async () => {
  const { result, rentExemptionSpaces } = await buildOne({ fixture: "bern-t22", recipientExists: false });
  assert.equal(result.ok, true);
  assert.equal(rentExemptionSpaces.length, 1);
  assert.notEqual(rentExemptionSpaces[0], "165");
});

test("the plan route preserves the reviewed blockhash and passes the current epoch into the transfer facts", () => {
  const source = readFileSync(new URL("../../app/api/solana/transfer/plan/route.ts", import.meta.url), "utf8");
  assert.match(source, /getEpochInfo\(/);
  assert.match(source, /epoch:/);
  assert.match(source, /replaceRecentBlockhash:\s*false/);
});

test("an existing recipient account produces one instruction, not two", async function () {
  const { result } = await buildOne({ recipientExists: true });
  assert.equal(result.ok, true);
  assert.equal(result.plan.createsRecipientAccount, false);
  assert.equal(result.plan.fingerprint.instructionCount, 1);
});

test("the sender's balance is read from the chain, and a short balance refuses", async function () {
  const { result } = await buildOne({ senderBalance: "999999" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INSUFFICIENT_BALANCE");
  assert.match(result.reason, /holds 999999 base units/);
  assert.match(result.reason, /read from the chain at build time, not assumed/);
});

test("a sender with no token account is refused before anything is built", async function () {
  const { result } = await buildOne({ senderMissing: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SENDER_ACCOUNT_MISSING");
  assert.match(result.reason, /holds no account for this mint/);
  /* Not a crash and not an empty balance: an account that does not exist is a
     different fact from an account holding zero, and only one of them can be
     fixed by receiving the token once. */
  assert.match(result.reason, /Receiving the token once creates the account/);
});

test("no blockhash means no transaction, with the reason named", async function () {
  const { result } = await buildOne({ blockhashFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BLOCKHASH_UNAVAILABLE");
});

test("evidence read from a different mint refuses before any account is derived", async function () {
  const raw = { ...fixture("usdc-spl"), network: "devnet" };
  const read = decodeRawMintAccount(raw);
  const passport = buildPassport(raw);
  const result = await buildTransferTransaction({
    handle: createSolanaRpcHandle({ network: "devnet" }),
    read,
    passport: passport.passport,
    epoch: 250n,
    input: {
      schemaVersion: "1.0.0",
      actionRef: SPL_TRANSFER_ACTION_REF,
      network: "devnet",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      recipient: RECIPIENT,
      amountRaw: "1000000",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INPUT_MINT_MISMATCH");
});

test("a wallet signing the exact bytes clears, and the signature is the transaction id", async function () {
  const { result, wallet } = await buildOne();
  const check = checkSignedTransfer({ plan: result.plan, signedWireBase64: walletSign(result.plan, wallet) });

  assert.equal(check.verdict, "CLEARED");
  assert.equal(check.signature.signer, String(wallet.address));
  assert.match(check.signature.value, /^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  assert.ok(check.comparisons.every((entry) => entry.matched));
  assert.match(check.signature.detail, /Ed25519 over the exact message bytes/);
});

test("a wallet that signs a different transaction is caught on the bytes, not on the envelope", async function () {
  const first = await buildOne();
  /* A second build for a different amount: same wallet, same accounts, same
     blockhash — everything a naive check would compare is identical. */
  const second = await buildOne({ wallet: first.wallet, amountRaw: "2000000" });

  const check = checkSignedTransfer({
    plan: first.result.plan,
    signedWireBase64: walletSign(second.result.plan, first.wallet),
  });
  assert.equal(check.verdict, "BYTES_CHANGED");
  assert.equal(check.signature.value, null);
  const hashes = check.comparisons.find((entry) => entry.field === "messageHash");
  assert.equal(hashes.matched, false);
  assert.notEqual(hashes.expected, hashes.actual);
});

test("a signature by the wrong key does not verify, even over the right bytes", async function () {
  const { result, wallet } = await buildOne();
  const stranger = testWallet();
  const decoded = getTransactionDecoder().decode(Buffer.from(result.plan.unsignedWireBase64, "base64"));
  const forged = Buffer.from(
    getTransactionEncoder().encode({
      messageBytes: decoded.messageBytes,
      /* The stranger's signature filed under the real signer's slot. */
      signatures: { ...decoded.signatures, [wallet.address]: stranger.sign(decoded.messageBytes) },
    }),
  ).toString("base64");

  const check = checkSignedTransfer({ plan: result.plan, signedWireBase64: forged });
  assert.equal(check.verdict, "SIGNATURE_INVALID");
  assert.match(check.detail, /does not verify over these exact message bytes/);
});

test("an unsigned transaction coming back is missing, not invalid — different sentences", async function () {
  const { result } = await buildOne();
  const check = checkSignedTransfer({ plan: result.plan, signedWireBase64: result.plan.unsignedWireBase64 });
  assert.equal(check.verdict, "SIGNATURE_MISSING");
  assert.match(check.detail, /may have been cancelled/);
});

test("garbage from the wallet is UNREADABLE rather than a crash", async function () {
  const { result } = await buildOne();
  for (const payload of ["", "bm90LWEtdHJhbnNhY3Rpb24=", "!!!!"]) {
    const check = checkSignedTransfer({ plan: result.plan, signedWireBase64: payload });
    assert.equal(check.verdict, "UNREADABLE", `${payload} was not refused`);
    assert.equal(check.signature.value, null);
  }
});

/* ── the operator's own byte check, which had no test until it refused a real
      signature and left the founder with "a different transaction" and no way
      to act on it ───────────────────────────────────────────────────────── */

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/** Return the plan's transaction with its compiled message swapped and signed. */
function walletReturns(plan, wallet, rewrite) {
  const decoded = getTransactionDecoder().decode(Buffer.from(plan.unsignedWireBase64, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(rewrite(message));
  return Buffer.from(
    getTransactionEncoder().encode({
      messageBytes,
      signatures: { ...decoded.signatures, [wallet.address]: wallet.sign(messageBytes) },
    }),
  ).toString("base64");
}

test("bytes that came back untouched clear the operator's check", async function () {
  const { result, wallet } = await buildOne();
  const check = await checkReturnedBytes({
    plan: result.plan,
    signedWireBase64: walletSign(result.plan, wallet),
  });
  assert.equal(check.verdict, "BYTES_MATCH");
  assert.equal(check.signerPresent, true);
  assert.equal(check.actualMessageHash, result.plan.fingerprint.messageHash);
});

/** A wallet's own priority-fee instruction, appended the way Phantom does. */
const withPriorityFee = (message, extra = []) => ({
  ...message,
  header: {
    ...message.header,
    numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1,
  },
  staticAccounts: [...message.staticAccounts, COMPUTE_BUDGET],
  instructions: [
    {
      programAddressIndex: message.staticAccounts.length,
      accountIndices: [],
      /* discriminator 3 = SetComputeUnitPrice, then u64 LE microLamports. */
      data: new Uint8Array([3, 0xe8, 0x03, 0, 0, 0, 0, 0, 0]),
    },
    ...message.instructions,
    ...extra,
  ],
});

test("a wallet's own priority fee passes, and the fee it asked for is stated in its own units", async function () {
  const { result, wallet } = await buildOne();
  const signedWireBase64 = walletReturns(result.plan, wallet, (message) => withPriorityFee(message));
  const check = await checkReturnedBytes({ plan: result.plan, signedWireBase64 });
  assert.equal(check.verdict, "BYTES_FEE_ADDED");
  assert.equal(check.signerPresent, true);
  assert.match(check.detail, /1,000 microLamports per compute unit/);
  /* The guarantee that is kept has to be stated, not implied. */
  assert.match(check.detail, /same recipient, same mint, same amount, same blockhash/);
});

test("a fee instruction inserted mid-list still passes — indices shift, meaning does not", async function () {
  const { result, wallet } = await buildOne();
  /* Insert among the read-only non-signers, which is the only legal place a
     recompiler can move a read-only program while preserving every account
     role. An index-wise comparison would still call the renumbering a rewrite. */
  const signedWireBase64 = walletReturns(result.plan, wallet, (message) => {
    const insertAt = message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts;
    const shifted = (index) => (index >= insertAt ? index + 1 : index);
    return {
      ...message,
      header: {
        ...message.header,
        numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1,
      },
      staticAccounts: [
        ...message.staticAccounts.slice(0, insertAt),
        COMPUTE_BUDGET,
        ...message.staticAccounts.slice(insertAt),
      ],
      instructions: [
        { programAddressIndex: insertAt, accountIndices: [], data: new Uint8Array([3, 0xe8, 0x03, 0, 0, 0, 0, 0, 0]) },
        ...message.instructions.map((instruction) => ({
          ...instruction,
          programAddressIndex: shifted(instruction.programAddressIndex),
          accountIndices: (instruction.accountIndices ?? []).map(shifted),
        })),
      ],
    };
  });
  const check = await checkReturnedBytes({ plan: result.plan, signedWireBase64 });
  assert.equal(check.verdict, "BYTES_FEE_ADDED");
});

test("a fee PLUS anything else is still refused — the relaxation is exactly one instruction wide", async function () {
  const { result, wallet } = await buildOne();
  /* The dangerous case the fee path must never launder: a wallet that attaches
     a plausible fee and rewrites the transfer in the same reply. */
  const signedWireBase64 = walletReturns(result.plan, wallet, (message) => {
    const withFee = withPriorityFee(message);
    return {
      ...withFee,
      instructions: withFee.instructions.map((instruction, index) =>
        index === withFee.instructions.length - 1
          ? { ...instruction, data: Uint8Array.from(instruction.data, (byte, at) => (at === 9 ? byte ^ 0xff : byte)) }
          : instruction,
      ),
    };
  });
  const check = await checkReturnedBytes({ plan: result.plan, signedWireBase64 });
  assert.equal(check.verdict, "BYTES_CHANGED");
  assert.match(check.detail, /programs, accounts or instruction data no longer match/);
});

test("a replaced blockhash is separated from a rewritten transfer — they need opposite responses", async function () {
  const { result, wallet } = await buildOne();
  const stale = walletReturns(result.plan, wallet, (message) => ({
    ...message,
    lifetimeToken: "11111111111111111111111111111111",
  }));
  const staleCheck = await checkReturnedBytes({ plan: result.plan, signedWireBase64: stale });
  assert.equal(staleCheck.verdict, "BYTES_CHANGED");
  assert.match(staleCheck.detail, /replaced the blockhash/);
  assert.match(staleCheck.detail, /Nothing about the transfer changed/);

  const rewritten = walletReturns(result.plan, wallet, (message) => ({
    ...message,
    instructions: message.instructions.map((instruction, index) =>
      index === message.instructions.length - 1
        ? { ...instruction, data: Uint8Array.from(instruction.data, (byte, at) => (at === 9 ? byte ^ 0xff : byte)) }
        : instruction,
    ),
  }));
  const rewrittenCheck = await checkReturnedBytes({ plan: result.plan, signedWireBase64: rewritten });
  assert.equal(rewrittenCheck.verdict, "BYTES_CHANGED");
  assert.match(rewrittenCheck.detail, /programs, accounts or instruction data no longer match/);
  assert.match(rewrittenCheck.detail, /do not approve it/);
  /* A rewritten amount must never read as the harmless case. */
  assert.doesNotMatch(rewrittenCheck.detail, /Nothing about the transfer changed/);
});

test("no refusal from the byte check is the bare sentence that names nothing", async function () {
  const { result, wallet } = await buildOne();
  const changed = walletReturns(result.plan, wallet, (message) => ({
    ...message,
    lifetimeToken: "11111111111111111111111111111111",
  }));
  const check = await checkReturnedBytes({ plan: result.plan, signedWireBase64: changed });
  /* The sentence the founder actually met said only this much, and stopped. */
  assert.notEqual(
    check.detail,
    "The wallet returned a different transaction from the one built here. Nothing is submitted — build again and read the wallet's own summary before approving.",
  );
});

test("the transaction builder is not shipped in the public evidence kit", { skip: needsDevelopmentRepository("the kit's extraction manifest under docs/solana/") }, function () {
  const manifest = JSON.parse(
    readFileSync(new URL("../../docs/solana/SDK-EXTRACTION-MANIFEST.json", import.meta.url), "utf8"),
  );
  const shipped = manifest.files.map((entry) => entry.path);
  for (const path of [
    "lib/solana/transaction.ts",
    "lib/solana/signature.ts",
    "lib/solana/wallet-adoption.ts",
  ]) {
    assert.ok(!shipped.includes(path), `${path} would turn the read-only kit into a writer`);
  }
});
