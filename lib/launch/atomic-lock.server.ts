/**
 * MC-1 — the creator's lock on Micro and the demo market, atomic (`SPEC.md` 25.10: «Замок творця на Micro зараз
 * неатомарний — виправити»; SEC-1: the creator could move the purchase before the lock landed).
 *
 * Before MC-1 the first purchase landed in the creator's wallet with the creation, and the lock followed as a second
 * transaction the creator's own wallet could make fail. Now both are one v1 transaction (SIMD-0385, up to 4 096 bytes;
 * the legacy format's 1 232 cannot hold them — measured 1 375 on devnet): the pool payer pays it, the creator signs
 * first, then the new mint and the escrow's base, the pool payer last. It lands whole or not at all.
 *
 * The pool payer stays whole as before: the creator's transfer to it is set from the simulation of these exact bytes,
 * and the bytes are simulated again and must leave the payer's balance where it was.
 */

import { createHash, createPrivateKey, sign } from "node:crypto";

import { PublicKey, SystemProgram, Transaction, type Connection, type Keypair } from "@solana/web3.js";

import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { buildV1Wire, isV1Wire, kitInstruction, readV1, withV1Signature } from "../solana/v1-tx.ts";

/** The most a v1 transaction holds, and the limits the creation's config names: the units from its own simulation. */
export const V1_MAX_BYTES = 4_096;
const MAX_UNITS = 1_400_000;
const LOADED_ACCOUNTS_BYTES = 64 * 1024 * 1024;

export type AtomicCreation = Readonly<{ ok: true; wireBase64: string; messageSha256: string; coveredLamports: string; creatorSpendLamports: string }>;
export type AtomicRefusal = Readonly<{ ok: false; reason: string }>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type RawRpc = (method: string, args: unknown[]) => Promise<Readonly<{ result?: { value?: { err: unknown; accounts?: readonly ({ lamports: number } | null)[] | null; unitsConsumed?: number } }; error?: { message?: string } }>>;

/** The lamports each account loses when the node simulates v1 bytes, and the units they take. */
async function simulateV1(connection: Connection, wireBase64: string, accounts: readonly PublicKey[]): Promise<Readonly<{ spent: readonly bigint[]; units: number }> | AtomicRefusal> {
  const raw = (connection as unknown as { _rpcRequest?: RawRpc })._rpcRequest;
  if (typeof raw !== "function") return { ok: false, reason: "This node cannot simulate a v1 transaction." };
  const before = await Promise.all(accounts.map(async (account) => BigInt(await connection.getBalance(account, "confirmed"))));
  const answer = await raw.call(connection, "simulateTransaction", [
    wireBase64,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: accounts.map((account) => account.toBase58()) } },
  ]);
  const value = answer.result?.value;
  if (answer.error || !value) return { ok: false, reason: `The creation could not be simulated: ${answer.error?.message ?? "no answer"}.` };
  if (value.err) return { ok: false, reason: `The creation with its lock does not simulate: ${JSON.stringify(value.err)}.` };
  const spent: bigint[] = [];
  for (const [index, account] of (value.accounts ?? []).entries()) {
    if (!account || typeof account.lamports !== "number") return { ok: false, reason: "The simulation did not return a balance." };
    spent.push((before[index] ?? 0n) - BigInt(account.lamports));
  }
  if (spent.length !== accounts.length) return { ok: false, reason: "The simulation did not return every balance." };
  return { spent, units: Number(value.unitsConsumed ?? MAX_UNITS) };
}

/** The lamports of a System Program transfer's data (`u32` 2, then `u64`). */
function transferLamports(data: Buffer): bigint | null {
  return data.length === 12 && data.readUInt32LE(0) === 2 ? data.readBigUInt64LE(4) : null;
}

/**
 * The creation (the creator's transfer to the pool payer first, then the curve and the first purchase) and the lock in
 * one unsigned v1 transaction the pool payer pays, simulated whole: the transfer is what the payer spends on these
 * exact bytes, and a second simulation must leave it whole.
 */
export async function composeAtomicCreation(
  connection: Connection,
  input: Readonly<{ creation: Transaction; lock: Transaction; creator: string; payer: PublicKey; validUntil: number }>,
): Promise<AtomicCreation | AtomicRefusal> {
  const [cover, ...rest] = input.creation.instructions;
  const creator = new PublicKey(input.creator);
  const covered0 = cover && cover.programId.equals(SystemProgram.programId) && cover.keys[0]?.pubkey.equals(creator) && cover.keys[1]?.pubkey.equals(input.payer) ? transferLamports(cover.data) : null;
  if (covered0 === null) return { ok: false, reason: "The creation does not open with the creator's transfer to the pool payer." };
  const blockhash = input.creation.recentBlockhash;
  if (!blockhash) return { ok: false, reason: "The creation has no blockhash." };
  const build = (covered: bigint, units: number) => {
    const wire = buildV1Wire({
      owner: input.payer.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: creator, toPubkey: input.payer, lamports: covered }), ...rest, ...input.lock.instructions].map(kitInstruction),
      blockhash,
      lastValidBlockHeight: input.validUntil,
      limits: { computeUnitLimit: units, loadedAccountsDataSizeLimit: LOADED_ACCOUNTS_BYTES, priorityFeeLamports: 0n },
    });
    return Buffer.from(wire, "base64").length <= V1_MAX_BYTES ? wire : null;
  };
  const first = build(covered0, MAX_UNITS);
  if (!first) return { ok: false, reason: "The creation with its lock is larger than a v1 transaction holds." };
  const probe = await simulateV1(connection, first, [input.payer, creator]);
  if ("ok" in probe) return probe;
  /* What the payer still spends on these bytes — the fee of the lock's signer — the creator hands over too. */
  const covered = covered0 + (probe.spent[0] ?? 0n);
  const units = Math.min(MAX_UNITS, Math.ceil(probe.units * 1.2) + 10_000);
  const wire = build(covered, units);
  if (!wire) return { ok: false, reason: "The creation with its lock is larger than a v1 transaction holds." };
  const sealed = await simulateV1(connection, wire, [input.payer, creator]);
  if ("ok" in sealed) return sealed;
  if (sealed.spent[0] !== 0n) return { ok: false, reason: `The pool payer's balance would change by ${-(sealed.spent[0] ?? 0n)} lamports on this launch.` };
  return { ok: true, wireBase64: wire, messageSha256: sha256(readV1(Buffer.from(wire, "base64")).messageBytes), coveredLamports: covered.toString(), creatorSpendLamports: (sealed.spent[1] ?? 0n).toString() };
}

/** PKCS#8 header of a raw 32-byte ed25519 seed. */
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

function ed25519Sign(message: Uint8Array, key: Keypair): Uint8Array {
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, Buffer.from(key.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return Uint8Array.from(sign(null, Buffer.from(message), privateKey));
}

/** A v1 creation as the send takes it: signed key by key over its one message, its id the fee payer's signature. */
export class V1Creation {
  #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = Uint8Array.from(bytes);
  }

  partialSign(...keys: readonly Keypair[]): void {
    for (const key of keys) this.#bytes = withV1Signature(this.#bytes, key.publicKey.toBase58(), ed25519Sign(readV1(this.#bytes).messageBytes, key));
  }

  /** The one message every signature covers — what a signer that holds no key here (the pool payer, CITY-162) signs. */
  messageBytes(): Uint8Array {
    return Uint8Array.from(readV1(this.#bytes).messageBytes);
  }

  /** A signature made elsewhere, written into its signer's slot. */
  addSignature(signer: string, signature: Uint8Array): void {
    this.#bytes = withV1Signature(this.#bytes, signer, signature);
  }

  serialize(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  /** In the message's signer order: the fee payer — the pool payer — first. */
  get signatures(): readonly Readonly<{ signature: Uint8Array | null }>[] {
    return readV1(this.#bytes).signatures.map((signature) => ({ signature }));
  }

  get recentBlockhash(): string {
    return readV1(this.#bytes).view.lifetime;
  }
}

/**
 * The creator's signed v1 bytes against the remembered message, byte for byte (the pool payer pays: nothing may be
 * added); the creator's signature real; then `keys` sign; every signature but `except`'s (the pool payer, last) real.
 */
export function readSignedV1(
  wireBase64: string,
  messageSha256: string,
  creator: string,
  keys: readonly Keypair[],
  except: PublicKey | null,
): Readonly<{ ok: true; creation: V1Creation }> | Readonly<{ ok: false; code: "SIGNED_OTHER_BYTES" | "SIGNATURE_MISSING"; reason: string }> {
  const bytes = Buffer.from(wireBase64, "base64");
  let read;
  try {
    if (!isV1Wire(bytes)) throw new Error("legacy");
    read = readV1(bytes);
  } catch {
    return { ok: false, code: "SIGNED_OTHER_BYTES", reason: "The wallet signed a different transaction than the one built." };
  }
  if (sha256(read.messageBytes) !== messageSha256) return { ok: false, code: "SIGNED_OTHER_BYTES", reason: "The wallet signed a different transaction than the one built." };
  const valid = (at: number, message: Uint8Array, signatures: readonly (Uint8Array | null)[], signers: readonly string[]) => {
    const signature = signatures[at];
    return Boolean(signature) && ed25519Valid(message, signature!, new PublicKey(signers[at]!));
  };
  const creatorAt = read.signers.indexOf(creator);
  if (creatorAt < 0 || !valid(creatorAt, read.messageBytes, read.signatures, read.signers)) return { ok: false, code: "SIGNATURE_MISSING", reason: "The transaction is not signed by the creator." };
  const creation = new V1Creation(bytes);
  try {
    if (keys.length) creation.partialSign(...keys);
  } catch {
    return { ok: false, code: "SIGNED_OTHER_BYTES", reason: "The wallet signed a different transaction than the one built." };
  }
  const after = readV1(creation.serialize());
  const unsigned = after.signers.filter((signer, at) => !(except && signer === except.toBase58()) && !valid(at, after.messageBytes, after.signatures, after.signers));
  if (unsigned.length) return { ok: false, code: "SIGNATURE_MISSING", reason: "A signature does not match the transaction." };
  return { ok: true, creation };
}
