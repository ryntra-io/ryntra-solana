/**
 * What a Meteora DLMM limit transaction may do — read before the wallet's
 * bytes are relayed. No SDK here: the rules are the program's instruction
 * layouts (lb_clmm 0.12.0), so they load and test anywhere.
 */

import { createHash, createHmac } from "node:crypto";

import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";

import { base58, DLMM_PROGRAM, LIGHTHOUSE_PROGRAM } from "./model.ts";
import { ed25519Valid, LIGHTHOUSE_FIRST_ASSERTION, MAX_PRIORITY_LAMPORTS } from "./trigger-tx.ts";

const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TyNMKSDgWgN2ub7ZM4eE6h", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();

export const DLMM_DISCRIMINATOR = {
  place: "6cb021ba92e501c5",
  cancel: "849c841f4328e861",
  close: "397c249b7ef95dab",
  initBinArray: "235613b94ed44bd3",
  initBitmapExtension: "2f9de2b40cf02147",
} as const;

/* ------------------------------------------------------------ order key */

/**
 * The wallet signs first. A placement needs a second signature — the order
 * account's, a fresh key that holds nothing and is needed only to open the
 * account — and a wallet such as Phantom refuses bytes another key already
 * signed («Request blocked»). So the Review hands the wallet the bytes with the
 * order's slot empty, and the relay signs after the wallet, over the exact
 * message the wallet signed.
 *
 * The order's key is not carried anywhere: it is derived from the server's
 * secret and from what the transaction does, with the order account itself
 * written as «order». The relay derives it again from the wallet's bytes; the
 * key comes out as the order's address only if the bytes do what was reviewed,
 * so the server never signs anything else — and the clients, web and phone, send
 * back the same fields as before.
 */
export const ORDER_KEY_ENV = "BETA_TOKEN_SECRET";
const ORDER_KEY_PURPOSE = "limits.dlmm.order.v1";

/** An instruction a wallet may add on signing: a Lighthouse assertion, or a compute-budget setting. */
function walletsOwn(instruction: TransactionInstruction): boolean {
  const program = instruction.programId.toBase58();
  return program === COMPUTE_BUDGET || program === LIGHTHOUSE_PROGRAM;
}

/** sha256 over the payer, the blockhash and every instruction but a wallet's own — program, accounts with their signer flag (the order account as «order»), data. */
export function dlmmOrderDigest(transaction: Transaction, order: string): string {
  const hash = createHash("sha256");
  const field = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    hash.update(length).update(bytes);
  };
  field(ORDER_KEY_PURPOSE);
  field(transaction.feePayer?.toBase58() ?? "");
  field(transaction.recentBlockhash ?? "");
  for (const instruction of transaction.instructions) {
    if (walletsOwn(instruction)) continue;
    field(instruction.programId.toBase58());
    field(instruction.keys.map((key) => {
      const address = key.pubkey.toBase58();
      return `${address === order ? "order" : address}:${key.isSigner ? 1 : 0}`;
    }).join(","));
    field(instruction.data);
  }
  return hash.digest("hex");
}

/** The order's key for a digest; null when the server has no secret (then nothing is built). */
export function dlmmOrderKey(digest: string, env: Readonly<Record<string, string | undefined>>): Keypair | null {
  const secret = env[ORDER_KEY_ENV];
  if (!secret || secret.length < 16) return null;
  const derived = createHmac("sha256", secret).update(ORDER_KEY_PURPOSE).digest();
  return Keypair.fromSeed(createHmac("sha256", derived).update(digest).digest());
}

/**
 * Seat the order's key in a placement built with a draft account in its place:
 * the derived key is the digest's, which does not see which address sits in the
 * order's slot. Returns the transaction to show, unsigned, and the order's key.
 */
export function withDlmmOrderKey(
  built: Transaction,
  draft: PublicKey,
  env: Readonly<Record<string, string | undefined>>,
): Readonly<{ transaction: Transaction; limitOrder: Keypair }> | null {
  /* The digest is of the bytes as the wallet and the relay read them: a key's signer flag is the message's, not the instruction's. */
  const asRead = (transaction: Transaction) => Transaction.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const limitOrder = dlmmOrderKey(dlmmOrderDigest(asRead(built), draft.toBase58()), env);
  if (!limitOrder) return null;
  const transaction = new Transaction({ feePayer: built.feePayer ?? undefined, blockhash: built.recentBlockhash as string, lastValidBlockHeight: built.lastValidBlockHeight as number });
  for (const instruction of built.instructions) {
    transaction.add(new TransactionInstruction({
      programId: instruction.programId,
      data: Buffer.from(instruction.data),
      keys: instruction.keys.map((key) => (key.pubkey.equals(draft) ? { ...key, pubkey: limitOrder.publicKey } : { ...key })),
    }));
  }
  /* What the relay will derive from these bytes is this key, or nothing is shown. */
  const order = limitOrder.publicKey.toBase58();
  if (dlmmOrderKey(dlmmOrderDigest(asRead(transaction), order), env)?.publicKey.toBase58() !== order) return null;
  return { transaction, limitOrder };
}

export type DlmmCosigned = Readonly<{ ok: true; wireBase64: string }> | Readonly<{ ok: false; code: "ORDER_KEY_UNAVAILABLE" | "SIGNED_MISMATCH" | "NOT_SIGNED"; reason: string }>;

/**
 * The wallet's signed placement, signed by the order's key after it. The bytes
 * pass the lane's own reading first (`inspectDlmmTransaction`: the wallet pays,
 * only the order and the wallet's housekeeping, Lighthouse assertions and a
 * capped compute budget); then the key is derived again from them and must be
 * the order's address — any change to what was reviewed gives another key, and
 * nothing is signed. The key signs over the exact message the wallet signed
 * (`VersionedTransaction.sign`), and every signature must then be real over it.
 */
export function cosignDlmmPlace(
  wireBase64: string,
  expect: Readonly<{ owner: string; limitOrder: string; pool: string | null }>,
  env: Readonly<Record<string, string | undefined>>,
): DlmmCosigned {
  const order = expect.limitOrder;
  const read = inspectDlmmTransaction(wireBase64, { ...expect, kind: "place" });
  if (!read.ok) return { ok: false, code: "SIGNED_MISMATCH", reason: read.reason };
  let transaction: Transaction;
  let exact: VersionedTransaction;
  try {
    transaction = Transaction.from(Buffer.from(wireBase64, "base64"));
    exact = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  } catch {
    return { ok: false, code: "SIGNED_MISMATCH", reason: "The transaction could not be read." };
  }
  if (exact.version !== "legacy") return { ok: false, code: "SIGNED_MISMATCH", reason: "The transaction is not the reviewed legacy transaction." };
  const key = dlmmOrderKey(dlmmOrderDigest(transaction, order), env);
  if (!key) return { ok: false, code: "ORDER_KEY_UNAVAILABLE", reason: "The server cannot sign for the order right now." };
  if (key.publicKey.toBase58() !== order) return { ok: false, code: "SIGNED_MISMATCH", reason: "The signed transaction is not the reviewed order." };
  try {
    exact.sign([key]);
  } catch {
    return { ok: false, code: "SIGNED_MISMATCH", reason: "The order's account does not sign this transaction." };
  }
  const message = exact.message.serialize();
  const required = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
  const allReal = required.every((signer, at) => {
    const signature = exact.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signer);
  });
  if (!allReal) return { ok: false, code: "NOT_SIGNED", reason: "A signature is missing or does not match." };
  return { ok: true, wireBase64: Buffer.from(exact.serialize()).toString("base64") };
}

/** Every signature a legacy transaction needs is present and real over its message — the wallet's and the order account's. */
export function signedByAll(wireBase64: string): boolean {
  try {
    return Transaction.from(Buffer.from(wireBase64, "base64")).verifySignatures(true);
  } catch {
    return false;
  }
}

/**
 * Read a signed DLMM transaction before relaying it: the wallet pays; only the
 * order's own instructions and the wallet's own token-account housekeeping are
 * inside; the order instruction names the wallet as owner.
 */
export function inspectDlmmTransaction(
  wireBase64: string,
  expect: Readonly<{ owner: string; kind: "place" | "cancel"; limitOrder: string; pool?: string | null }>,
): Readonly<{ ok: true; signature: string | null; pool: string | null }> | Readonly<{ ok: false; reason: string }> {
  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(wireBase64, "base64"));
  } catch {
    return { ok: false, reason: "The transaction could not be read." };
  }
  const owner = expect.owner;
  if (transaction.feePayer?.toBase58() !== owner) return { ok: false, reason: "Someone other than the wallet pays for the transaction." };
  const ownerKey = new PublicKey(owner);
  const ownWrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, ownerKey, true).toBase58();
  /* The wallet, and on a placement the order's fresh account: no third signer. */
  if (transaction.signatures.length > (expect.kind === "place" ? 2 : 1)) return { ok: false, reason: "The transaction asks for more signatures than the order needs." };
  let placedPool: string | null = null;
  let unitLimit = 200_000n;
  let unitPrice = 0n;
  let orderInstructions = 0;
  for (const ix of transaction.instructions) {
    const program = ix.programId.toBase58();
    const keys = ix.keys.map((key) => key.pubkey.toBase58());
    const data = Buffer.from(ix.data);
    if (MEMO_PROGRAMS.has(program)) continue;
    if (program === LIGHTHOUSE_PROGRAM) {
      if (data.length === 0 || data[0] < LIGHTHOUSE_FIRST_ASSERTION) return { ok: false, reason: "A wallet instruction that is not an assertion." };
      continue;
    }
    if (program === COMPUTE_BUDGET) {
      if (data[0] === 2 && data.length >= 5) unitLimit = BigInt(data.readUInt32LE(1));
      else if (data[0] === 3 && data.length >= 9) unitPrice = data.readBigUInt64LE(1);
      /* A loaded-accounts data limit, which Phantom asks dApps to set and may set itself: up to the runtime's own 64 MiB. */
      else if (data[0] === 4 && data.length >= 5) {
        if (data.readUInt32LE(1) > 64 * 1024 * 1024) return { ok: false, reason: "An unexpected compute-budget instruction." };
      } else return { ok: false, reason: "An unexpected compute-budget instruction." };
      continue;
    }
    if (program === ATA_PROGRAM) {
      if (keys[0] !== owner || keys[2] !== owner) return { ok: false, reason: "The transaction creates a token account for someone else." };
      continue;
    }
    if (program === SystemProgram.programId.toBase58()) {
      if (data.length < 12 || data.readUInt32LE(0) !== 2 || keys[0] !== owner || keys[1] !== ownWrappedSol) return { ok: false, reason: "The transaction moves SOL somewhere other than the wallet's own wrapped-SOL account." };
      continue;
    }
    if (program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58()) {
      /* SyncNative (17) on the wrapped-SOL account, or CloseAccount (9) of it back to the wallet. */
      if (data.length === 1 && data[0] === 17 && keys[0] === ownWrappedSol) continue;
      if (data.length === 1 && data[0] === 9 && keys[0] === ownWrappedSol && keys[1] === owner) continue;
      return { ok: false, reason: "An unexpected token instruction." };
    }
    if (program === DLMM_PROGRAM) {
      const discriminator = data.subarray(0, 8).toString("hex");
      if (discriminator === DLMM_DISCRIMINATOR.initBinArray || discriminator === DLMM_DISCRIMINATOR.initBitmapExtension) {
        /* Funder pays the rent of a bin array the order needs. */
        if (keys[2] !== owner) return { ok: false, reason: "Someone else funds the pool's bins." };
        continue;
      }
      if (expect.kind === "place" && discriminator === DLMM_DISCRIMINATOR.place) {
        /* lb_pair 0, …, limit_order 4, payer 5, owner 6, user_token 7, sender 8. */
        if (expect.pool && keys[0] !== expect.pool) return { ok: false, reason: "The order sits in another pool than reviewed." };
        placedPool = keys[0] ?? null;
        if (keys[4] !== expect.limitOrder || keys[5] !== owner || keys[6] !== owner || keys[8] !== owner) return { ok: false, reason: "The order belongs to another wallet." };
        orderInstructions += 1;
        continue;
      }
      if (expect.kind === "cancel" && discriminator === DLMM_DISCRIMINATOR.cancel) {
        /* token_x_mint 4, token_y_mint 5, limit_order 6, owner_token_x 7, owner_token_y 8, owner 9, token programs 10 and 11. */
        if (keys[6] !== expect.limitOrder || keys[9] !== owner) return { ok: false, reason: "The cancellation is for another order or wallet." };
        const own = (mint: string | undefined, tokenProgram: string | undefined) => (mint && tokenProgram ? getAssociatedTokenAddressSync(new PublicKey(mint), ownerKey, true, new PublicKey(tokenProgram)).toBase58() : null);
        if (keys[7] !== own(keys[4], keys[10]) || keys[8] !== own(keys[5], keys[11])) return { ok: false, reason: "The cancellation returns the money to someone else." };
        continue;
      }
      if (expect.kind === "cancel" && discriminator === DLMM_DISCRIMINATOR.close) {
        if (keys[0] !== expect.limitOrder || keys[1] !== owner || keys[2] !== owner) return { ok: false, reason: "The order's rent goes to someone else." };
        orderInstructions += 1;
        continue;
      }
      return { ok: false, reason: "An unexpected pool instruction." };
    }
    return { ok: false, reason: `The transaction calls a program outside the order: ${program}.` };
  }
  if (orderInstructions !== 1) return { ok: false, reason: "The transaction does not hold exactly one order instruction." };
  if ((unitLimit * unitPrice) / 1_000_000n > MAX_PRIORITY_LAMPORTS) return { ok: false, reason: "The transaction's priority fee is above the cap." };
  const signature = transaction.signatures.find((entry) => entry.publicKey.equals(ownerKey))?.signature ?? null;
  return { ok: true, signature: signature ? base58(signature) : null, pool: placedPool };
}

