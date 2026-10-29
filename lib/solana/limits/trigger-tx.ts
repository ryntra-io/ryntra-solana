/**
 * What a Jupiter Trigger V1 transaction is allowed to do before a person signs
 * it — and the same check again on the bytes that come back signed.
 *
 * Jupiter builds the transaction; Ryntra relays it. A relay that forwards
 * whatever an upstream returned is a relay that would forward a drain, so the
 * transaction is read instruction by instruction and anything outside this
 * list refuses it:
 *
 * - Compute Budget: a unit limit and a unit price, the two together capped;
 * - Associated Token: create-idempotent of an account **the signer owns**;
 * - System: a transfer from the signer to the signer's own wrapped-SOL account
 *   (wrapping SOL for an order that spends it);
 * - Token: `SyncNative` on that account, or closing it back to the signer;
 * - Lighthouse assertions a wallet may add (never its memory writes) — they move nothing;
 * - the Trigger program: exactly one `initialize_order` whose maker and payer
 *   are the signer and whose amounts and fee are the ones reviewed, or exactly
 *   one `cancel_order` of the named order by its maker.
 *
 * Read off live `createOrder` / `cancelOrder` responses on 2026-10-15: version
 * 0, no lookup tables, one signer, these instructions and no others.
 */

import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { createPublicKey, verify } from "node:crypto";

import { LIGHTHOUSE_PROGRAM, TRIGGER_V1_PROGRAM } from "./model.ts";

const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** Lighthouse's own memory instructions are 0 (write) and 1 (close); every assertion comes after. */
export const LIGHTHOUSE_FIRST_ASSERTION = 2;
/** Anchor discriminators: sha256("global:<name>")[0..8]. */
const INITIALIZE_ORDER = "856e4aaf709ff59f";
const CANCEL_ORDER = "5f81edf00831df84";
/** Account discriminator of `Order`. */
export const TRIGGER_ORDER_DISCRIMINATOR = "86addfb94d561c33";

/** The most a transaction may spend on priority, lamports: 0.005 SOL. A keeper-grade price on a 1.4 M unit limit stays under it. */
export const MAX_PRIORITY_LAMPORTS = 5_000_000n;

export type TriggerCreateExpectation = Readonly<{
  kind: "create";
  owner: string;
  inputMint: string;
  outputMint: string;
  makingRaw: string;
  takingRaw: string;
  /** The fee account the plan named, or null for none. */
  feeAccount: string | null;
  /** The `feeBps` the plan sent, or null for none. */
  feeBps: number | null;
}>;

export type TriggerCancelExpectation = Readonly<{ kind: "cancel"; owner: string; order: string }>;

export type TriggerTxVerdict =
  | Readonly<{ ok: true; order: string; message: string }>
  | Readonly<{ ok: false; reason: string }>;

function u64(data: Uint8Array, offset: number): bigint {
  return Buffer.from(data).readBigUInt64LE(offset);
}

/** InitializeOrderParams: unique_id u64, making u64, taking u64, expired_at Option<i64>, fee_bps Option<u16>, slippage_bps Option<u16>. */
export function decodeInitializeOrder(data: Uint8Array): Readonly<{
  makingRaw: string;
  takingRaw: string;
  expiredAt: number | null;
  feeBps: number | null;
  slippageBps: number | null;
}> | null {
  const bytes = Buffer.from(data);
  if (bytes.length < 8 + 24 + 1) return null;
  let offset = 8 + 8;
  const making = u64(bytes, offset);
  offset += 8;
  const taking = u64(bytes, offset);
  offset += 8;
  const option = (size: number): bigint | null => {
    const tag = bytes[offset];
    offset += 1;
    if (tag === 0) return null;
    const value = size === 8 ? bytes.readBigInt64LE(offset) : BigInt(bytes.readUInt16LE(offset));
    offset += size;
    return value;
  };
  try {
    const expiredAt = option(8);
    const feeBps = option(2);
    const slippageBps = option(2);
    return {
      makingRaw: making.toString(),
      takingRaw: taking.toString(),
      expiredAt: expiredAt === null ? null : Number(expiredAt),
      feeBps: feeBps === null ? null : Number(feeBps),
      slippageBps: slippageBps === null ? null : Number(slippageBps),
    };
  } catch {
    return null;
  }
}

/** The `Order` account's fields the review needs; offsets as laid out by limit_order_2 0.1.0. */
export function decodeTriggerOrderAccount(data: Uint8Array): Readonly<{
  maker: string;
  inputMint: string;
  outputMint: string;
  makingRaw: string;
  takingRaw: string;
  expiredAt: number | null;
  feeBps: number;
  feeAccount: string;
}> | null {
  const bytes = Buffer.from(data);
  if (bytes.length < 260 || bytes.subarray(0, 8).toString("hex") !== TRIGGER_ORDER_DISCRIMINATOR) return null;
  const key = (at: number) => new PublicKey(bytes.subarray(at, at + 32)).toBase58();
  /* 8 disc · maker · input · output · input program · output program · reserve (6 × 32) · unique_id · ori making · ori taking · making · taking · borrow (6 × 8). */
  let offset = 8 + 6 * 32 + 8 + 8 + 8;
  const making = bytes.readBigUInt64LE(offset);
  offset += 8;
  const taking = bytes.readBigUInt64LE(offset);
  offset += 16;
  const tag = bytes[offset];
  offset += 1;
  let expiredAt: number | null = null;
  if (tag === 1) {
    expiredAt = Number(bytes.readBigInt64LE(offset));
    offset += 8;
  }
  const feeBps = bytes.readUInt16LE(offset);
  offset += 2;
  return {
    maker: key(8),
    inputMint: key(40),
    outputMint: key(72),
    makingRaw: making.toString(),
    takingRaw: taking.toString(),
    expiredAt,
    feeBps,
    feeAccount: key(offset),
  };
}

/** What the compute-budget instructions ask for priority, lamports. */
export function priorityLamports(transaction: VersionedTransaction): bigint {
  let limit = 200_000n;
  let price = 0n;
  const keys = transaction.message.staticAccountKeys;
  for (const ix of transaction.message.compiledInstructions) {
    if (!keys[ix.programIdIndex]?.equals(ComputeBudgetProgram.programId)) continue;
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length >= 5) limit = BigInt(data.readUInt32LE(1));
    if (data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
  }
  return (limit * price) / 1_000_000n;
}

/**
 * Read a Trigger transaction against what was reviewed. The same function runs
 * on Jupiter's unsigned transaction before the Review and on the signed bytes
 * before they are relayed.
 */
export function inspectTriggerTransaction(
  wireBase64: string,
  expect: TriggerCreateExpectation | TriggerCancelExpectation,
): TriggerTxVerdict {
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  } catch {
    return { ok: false, reason: "The transaction could not be read." };
  }
  const message = transaction.message;
  if (message.addressTableLookups.length > 0) return { ok: false, reason: "The transaction loads accounts from a lookup table." };
  if (message.header.numRequiredSignatures !== 1) return { ok: false, reason: "The transaction asks for more than one signature." };
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  const owner = expect.owner;
  if (keys[0] !== owner) return { ok: false, reason: "Someone other than the wallet pays for the transaction." };
  const ownerKey = new PublicKey(owner);
  const ownWrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, ownerKey, true).toBase58();

  let orderInstructions = 0;
  let order: string | null = null;
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const accounts = ix.accountKeyIndexes.map((index) => keys[index]);
    const data = Buffer.from(ix.data);
    if (program === ComputeBudgetProgram.programId.toBase58()) {
      if (data[0] !== 2 && data[0] !== 3) return { ok: false, reason: "An unexpected compute-budget instruction." };
      continue;
    }
    if (program === LIGHTHOUSE_PROGRAM) {
      /* Assertions only (instruction 2 and up); 0 and 1 write and close Lighthouse's own memory accounts. */
      if (data.length === 0 || data[0] < LIGHTHOUSE_FIRST_ASSERTION) return { ok: false, reason: "A wallet instruction that is not an assertion." };
      continue;
    }
    if (program === ATA_PROGRAM) {
      /* create (0) or create-idempotent (1): payer, account, wallet, mint, system, token program. */
      if ((data.length !== 0 && data[0] !== 0 && data[0] !== 1) || accounts[0] !== owner || accounts[2] !== owner) {
        return { ok: false, reason: "The transaction creates a token account for someone else." };
      }
      continue;
    }
    if (program === SystemProgram.programId.toBase58()) {
      /* Transfer (2): from, to. Only into the signer's own wrapped-SOL account. */
      if (data.length < 12 || data.readUInt32LE(0) !== 2 || accounts[0] !== owner || accounts[1] !== ownWrappedSol) {
        return { ok: false, reason: "The transaction moves SOL somewhere other than the wallet's own wrapped-SOL account." };
      }
      continue;
    }
    if (program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58()) {
      /* SyncNative (17) on the wallet's wrapped-SOL account, or CloseAccount (9) of it back to the wallet — unwrapping a refund. */
      if (data.length === 1 && data[0] === 17 && accounts[0] === ownWrappedSol) continue;
      if (data.length === 1 && data[0] === 9 && accounts[0] === ownWrappedSol && accounts[1] === owner) continue;
      return { ok: false, reason: "An unexpected token instruction." };
      continue;
    }
    if (program === TRIGGER_V1_PROGRAM) {
      orderInstructions += 1;
      const discriminator = data.subarray(0, 8).toString("hex");
      if (expect.kind === "create") {
        if (discriminator !== INITIALIZE_ORDER) return { ok: false, reason: "The transaction is not an order creation." };
        /* payer, maker, order, reserve, maker input account, fee, referral, input mint, output mint, … */
        if (accounts[0] !== owner || accounts[1] !== owner) return { ok: false, reason: "The order belongs to another wallet." };
        if (accounts[7] !== expect.inputMint || accounts[8] !== expect.outputMint) return { ok: false, reason: "The order trades other tokens than reviewed." };
        const params = decodeInitializeOrder(data);
        if (!params) return { ok: false, reason: "The order's terms could not be read." };
        if (params.makingRaw !== expect.makingRaw || params.takingRaw !== expect.takingRaw) {
          return { ok: false, reason: "The order's amounts differ from the reviewed ones." };
        }
        if ((params.slippageBps ?? 0) !== 0) return { ok: false, reason: "The order allows slippage below its price." };
        const referral = accounts[6];
        if (expect.feeAccount === null) {
          if (referral !== TRIGGER_V1_PROGRAM || params.feeBps !== null) return { ok: false, reason: "The order carries a fee that was not reviewed." };
        } else if (referral !== expect.feeAccount || params.feeBps !== expect.feeBps) {
          return { ok: false, reason: "The order's fee differs from the reviewed one." };
        }
        order = accounts[2] ?? null;
      } else {
        if (discriminator !== CANCEL_ORDER) return { ok: false, reason: "The transaction is not a cancellation." };
        /* signer, maker, order, reserve, maker_input_mint_account (optional), input_mint, input_token_program, … */
        if (accounts[0] !== owner || accounts[1] !== owner || accounts[2] !== expect.order) {
          return { ok: false, reason: "The cancellation is for another order or wallet." };
        }
        /* The refund goes to the maker's own account of the input token — or, absent, to the maker through the program. */
        const refund = accounts[4];
        const inputMint = accounts[5];
        const tokenProgram = accounts[6];
        if (!refund || !inputMint || !tokenProgram) return { ok: false, reason: "The cancellation's accounts could not be read." };
        const ownInput = getAssociatedTokenAddressSync(new PublicKey(inputMint), ownerKey, true, new PublicKey(tokenProgram)).toBase58();
        if (refund !== ownInput && refund !== TRIGGER_V1_PROGRAM) return { ok: false, reason: "The cancellation returns the money to someone else." };
        order = expect.order;
      }
      continue;
    }
    return { ok: false, reason: `The transaction calls a program outside the order: ${program}.` };
  }
  if (orderInstructions !== 1 || order === null) return { ok: false, reason: "The transaction does not hold exactly one order instruction." };
  if (priorityLamports(transaction) > MAX_PRIORITY_LAMPORTS) return { ok: false, reason: "The transaction's priority fee is above the cap." };
  return { ok: true, order, message: Buffer.from(message.serialize()).toString("base64") };
}

/** SPKI header of a raw 32-byte ed25519 public key. */
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** Whether `signature` is `key`'s ed25519 signature of `message`. */
export function ed25519Valid(message: Uint8Array, signature: Uint8Array, key: PublicKey): boolean {
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI, key.toBuffer()]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message), publicKey, Buffer.from(signature));
  } catch {
    return false;
  }
}

/** The signed versioned transaction carries the fee payer's real signature over its own message. */
export function signedByFeePayer(wireBase64: string): boolean {
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
    const payer = transaction.message.staticAccountKeys[0];
    const signature = transaction.signatures[0];
    if (!payer || !signature) return false;
    return ed25519Valid(transaction.message.serialize(), signature, payer);
  } catch {
    return false;
  }
}
