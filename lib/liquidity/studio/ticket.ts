/**
 * The seal between a Review and the relay. A Review builds the transactions,
 * shows what they do and hands back a ticket: the wallet, the action, and a
 * digest of what each transaction does, signed with the server's key. The relay
 * sends only bytes that do exactly that, in that order, signed by that wallet —
 * so what reaches the network is what the person read, and a request cannot
 * slip other bytes past the relay.
 *
 * What a transaction does is its payer, its blockhash and its instructions —
 * program, accounts with their signer flag, data — in order. A wallet may add
 * two kinds of instruction when it signs, and those are left out of the digest
 * and checked on their own: Lighthouse assertions (they only check balances and
 * move nothing) and compute-budget settings (held under a priority ceiling).
 *
 * The wallet signs first. A build that opens a position needs a second
 * signature — the fresh key of the new position account (or its NFT), a key
 * that holds nothing — and a wallet such as Phantom refuses to sign bytes
 * someone has already signed. So the Review hands the wallet the bytes with
 * that slot empty, carries the fresh key in the ticket sealed with the server's
 * key, and the relay adds its signature after the wallet's, over the exact
 * message the wallet signed.
 *
 * The only secret a ticket carries is a fresh position key, encrypted; it
 * expires with the transactions' blockhash. Without a key the server builds
 * nothing for anyone.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";

import { BLOCKHASH_LIFE_MS } from "../../solana/blockhash-life.ts";
import { base58, LIGHTHOUSE_PROGRAM } from "../../solana/limits/model.ts";
import { ed25519Valid, LIGHTHOUSE_FIRST_ASSERTION, MAX_PRIORITY_LAMPORTS } from "../../solana/limits/trigger-tx.ts";

import type { LiquidityVenueId } from "./contract.ts";
import type { Env, GatedAction } from "./gate.ts";
import type { LimitAction } from "./limit-orders.ts";

export const TICKET_KEY_ENV = "BETA_TOKEN_SECRET";
/**
 * The longest a ticket lives: the bytes' own life, 150 blocks at 200 ms slots (~30 s; `lib/solana/blockhash-life.ts`).
 * A Review seals the shorter of this and what its blockhash has left on the chain, so the ticket dies with the bytes.
 */
export const TICKET_TTL_MS = BLOCKHASH_LIFE_MS;
const PURPOSE = "liquidity.review.v1";

/** A Zap (CITY-198, `zap.ts`): SOL into a pier in one approval, or what a half-landed one left taken back as SOL. */
export type ZapAction = "zap_in" | "zap_rest";

/** What a ticket seals: a pool action, a limit order (`limit-orders.ts`), or a Zap (`zap.ts`). */
export type TicketAction = GatedAction | LimitAction | ZapAction;
const TICKET_ACTIONS: ReadonlySet<string> = new Set<TicketAction>(["add", "remove", "claim", "limit_place", "limit_cancel", "limit_roll", "zap_in", "zap_rest"]);
/** The most address lookup tables one sealed build may name. */
export const MAX_TICKET_LOOKUPS = 8;

export type LiquidityTicket = Readonly<{
  v: 1;
  owner: string;
  venue: LiquidityVenueId;
  action: TicketAction;
  pool: string;
  position: string;
  /** The digest of what each transaction does (`reviewedDigest`), hex, in the order they are signed and sent. */
  messages: readonly string[];
  /** The fresh keys the relay signs with after the wallet, sealed (`sealCosigners`); null when the wallet is the only signer. */
  cosign: string | null;
  /**
   * The address lookup tables the build's version-0 transactions read (a Zap's Jupiter leg); absent — legacy bytes only.
   * A table only ever grows and its old entries never change, so the relay reads them again to resolve exactly what
   * the Review resolved.
   */
  lookups?: readonly string[] | undefined;
  issuedAt: number;
  expiresAt: number;
}>;

function key(env: Env): string | null {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export function ticketKeyConfigured(env: Env): boolean {
  return key(env) !== null;
}

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/** An instruction a wallet may add on signing: a Lighthouse assertion, or a compute-budget setting. */
function walletsOwn(instruction: TransactionInstruction): boolean {
  const program = instruction.programId.toBase58();
  return program === COMPUTE_BUDGET || program === LIGHTHOUSE_PROGRAM;
}

/** What a transaction does, read off either wire format: its payer, its blockhash, its instructions and who signs it. */
export type DecodedTransaction = Readonly<{
  version: "legacy" | 0;
  feePayer: PublicKey | null;
  recentBlockhash: string | null;
  instructions: readonly TransactionInstruction[];
  /** The keys whose signatures the message requires, in order. */
  signers: readonly PublicKey[];
  /** The lookup tables a version-0 message reads. */
  lookups: readonly string[];
}>;

/**
 * A wire read as what it does. Legacy bytes need nothing more; version-0 bytes need the lookup tables they name, and
 * are refused (null) without every one of them.
 */
export function decodeWire(wireBase64: string, tables: readonly AddressLookupTableAccount[] = []): DecodedTransaction | null {
  try {
    const bytes = Buffer.from(wireBase64, "base64");
    const exact = VersionedTransaction.deserialize(bytes);
    const message = exact.message;
    const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
    if (exact.version === "legacy") {
      const legacy = Transaction.from(bytes);
      return { version: "legacy", feePayer: legacy.feePayer ?? null, recentBlockhash: legacy.recentBlockhash ?? null, instructions: legacy.instructions, signers, lookups: [] };
    }
    if (exact.version !== 0) return null;
    const lookups = message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58());
    const known = new Map(tables.map((table) => [table.key.toBase58(), table]));
    if (!lookups.every((key) => known.has(key))) return null;
    const decompiled = TransactionMessage.decompile(message, { addressLookupTableAccounts: lookups.map((key) => known.get(key)!) });
    return { version: 0, feePayer: decompiled.payerKey, recentBlockhash: decompiled.recentBlockhash, instructions: decompiled.instructions, signers, lookups };
  } catch {
    return null;
  }
}

/** sha256 over the payer, the blockhash and every instruction but a wallet's own — program, accounts with their signer flag, data. */
export function reviewedDigest(transaction: Readonly<{ feePayer?: PublicKey | null | undefined; recentBlockhash?: string | null | undefined; instructions: readonly TransactionInstruction[] }>): string {
  const hash = createHash("sha256");
  const field = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    hash.update(length).update(bytes);
  };
  field(transaction.feePayer?.toBase58() ?? "");
  field(transaction.recentBlockhash ?? "");
  for (const instruction of transaction.instructions) {
    if (walletsOwn(instruction)) continue;
    field(instruction.programId.toBase58());
    field(instruction.keys.map((key) => `${key.pubkey.toBase58()}:${key.isSigner ? 1 : 0}`).join(","));
    field(instruction.data);
  }
  return hash.digest("hex");
}

/** The digest of a built transaction, or null when the wire cannot be read — a version-0 one without its lookup tables. */
export function messageDigest(wireBase64: string, tables: readonly AddressLookupTableAccount[] = []): string | null {
  const decoded = decodeWire(wireBase64, tables);
  return decoded ? reviewedDigest(decoded) : null;
}

/** What a wallet added is allowed: assertions only from Lighthouse, and a priority fee under the ceiling. */
function budgetAllowed(transaction: Readonly<{ instructions: readonly TransactionInstruction[] }>): boolean {
  let unitLimit = 200_000n;
  let unitPrice = 0n;
  for (const instruction of transaction.instructions) {
    const program = instruction.programId.toBase58();
    const data = Buffer.from(instruction.data);
    if (program === LIGHTHOUSE_PROGRAM) {
      if (data.length === 0 || data[0]! < LIGHTHOUSE_FIRST_ASSERTION) return false;
    } else if (program === COMPUTE_BUDGET) {
      if (data[0] === 2 && data.length >= 5) unitLimit = BigInt(data.readUInt32LE(1));
      else if (data[0] === 3 && data.length >= 9) unitPrice = data.readBigUInt64LE(1);
      /* A loaded-accounts data limit, which Phantom asks dApps to set and may set itself: up to the runtime's own 64 MiB. */
      else if (data[0] === 4 && data.length >= 5) {
        if (data.readUInt32LE(1) > 64 * 1024 * 1024) return false;
      } else return false;
    }
  }
  return (unitLimit * unitPrice) / 1_000_000n <= MAX_PRIORITY_LAMPORTS;
}

/** What a wallet added on signing stays within its rules, and the signers are exactly the payer and those the reviewed instructions name. */
export function walletAdditionsAllowed(transaction: Transaction | DecodedTransaction): boolean {
  if (!budgetAllowed(transaction)) return false;
  /* Signer flags are the message's, not the instruction's: the signers must be exactly the payer and those the reviewed instructions name. */
  const named = new Set([transaction.feePayer?.toBase58() ?? ""]);
  for (const instruction of transaction.instructions) {
    if (walletsOwn(instruction)) continue;
    for (const key of instruction.keys) if (key.isSigner) named.add(key.pubkey.toBase58());
  }
  const signing = ("signers" in transaction ? transaction.signers : transaction.signatures.map((entry) => entry.publicKey)).map((key) => key.toBase58());
  return signing.length === named.size && signing.every((signer) => named.has(signer));
}

export function issueTicket(input: Omit<LiquidityTicket, "v" | "issuedAt" | "expiresAt">, env: Env, now = Date.now(), ttlMs = TICKET_TTL_MS): string | null {
  const secret = key(env);
  if (!secret) return null;
  const ticket: LiquidityTicket = { v: 1, ...input, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type TicketRead = Readonly<{ ok: true; ticket: LiquidityTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;

export function readTicket(value: unknown, env: Env, now = Date.now()): TicketRead {
  const secret = key(env);
  if (!secret || typeof value !== "string" || value.length > 8192) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<LiquidityTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<LiquidityTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    !isString(parsed.owner) ||
    (parsed.venue !== "meteora-dlmm" && parsed.venue !== "meteora-damm2") ||
    typeof parsed.action !== "string" ||
    !TICKET_ACTIONS.has(parsed.action) ||
    !isString(parsed.pool) ||
    !isString(parsed.position) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length === 0 ||
    parsed.messages.length > 16 ||
    !parsed.messages.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) ||
    !(parsed.cosign === null || (typeof parsed.cosign === "string" && parsed.cosign.length <= 4096)) ||
    !(parsed.lookups === undefined || (Array.isArray(parsed.lookups) && parsed.lookups.length <= MAX_TICKET_LOOKUPS && parsed.lookups.every(isString))) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as LiquidityTicket };
}

/** A fresh key and the transaction it signs, by index in the build's order. */
export type Cosigner = Readonly<{ index: number; key: Keypair }>;

const cosignKey = (secret: string) => createHmac("sha256", secret).update("liquidity.cosign.v1").digest();

/** The fresh keys, encrypted and authenticated with a key derived from the server's: the browser carries them, cannot read them. */
export function sealCosigners(cosigners: readonly Cosigner[], env: Env): string | null {
  const secret = key(env);
  if (!secret || cosigners.length === 0) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cosignKey(secret), iv);
  const plain = Buffer.from(JSON.stringify(cosigners.map((c) => ({ i: c.index, k: Buffer.from(c.key.secretKey).toString("base64") }))));
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url");
}

export function openCosigners(sealed: string | null, env: Env): readonly Cosigner[] | null {
  if (sealed === null) return [];
  const secret = key(env);
  if (!secret) return null;
  try {
    const bytes = Buffer.from(sealed, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", cosignKey(secret), bytes.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(bytes.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    const rows = JSON.parse(plain) as { i: unknown; k: unknown }[];
    return rows.map((row) => {
      if (typeof row.i !== "number" || typeof row.k !== "string") throw new Error("bad row");
      return { index: row.i, key: Keypair.fromSecretKey(Buffer.from(row.k, "base64")) };
    });
  } catch {
    return null;
  }
}

/**
 * Empty the signature slots of the given keys in a built transaction: the wallet sees bytes nobody has signed yet. The
 * message — what every signature covers — does not change.
 */
export function withoutSignaturesOf(wireBase64: string, keys: readonly string[]): string {
  const transaction = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  const signers = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map((k) => k.toBase58());
  for (const [index, signer] of signers.entries()) if (keys.includes(signer)) transaction.signatures[index] = new Uint8Array(64);
  return Buffer.from(transaction.serialize()).toString("base64");
}

export type SignedCheck = Readonly<{ ok: true; signatures: readonly string[]; wires: readonly string[] }> | Readonly<{ ok: false; code: "SIGNED_MISMATCH" | "NOT_SIGNED"; index: number }>;

/**
 * The wallet's bytes against the ticket: as many as were built, each one doing what its digest says in its own place,
 * paid for by the ticket's wallet, anything the wallet added within its rules — no signer more than the build named.
 * The ticket's fresh keys then sign over the exact message the wallet signed, and every signature must be real.
 * Returns each transaction's own id (its first signature, the wallet's) and the bytes to send.
 */
export function checkSigned(ticket: LiquidityTicket, signedWireBase64: readonly unknown[], cosigners: readonly Cosigner[] = [], tables: readonly AddressLookupTableAccount[] = []): SignedCheck {
  const sealedLookups = new Set(ticket.lookups ?? []);
  if (signedWireBase64.length !== ticket.messages.length) return { ok: false, code: "SIGNED_MISMATCH", index: Math.min(signedWireBase64.length, ticket.messages.length) };
  const signatures: string[] = [];
  const wires: string[] = [];
  for (let index = 0; index < signedWireBase64.length; index += 1) {
    const wire = signedWireBase64[index];
    if (typeof wire !== "string" || wire.length > 4096) return { ok: false, code: "SIGNED_MISMATCH", index };
    let exact: VersionedTransaction;
    try {
      exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "SIGNED_MISMATCH", index };
    }
    /* Version-0 bytes only where the Review sealed their lookup tables, and naming no other table. */
    if (exact.version !== "legacy") {
      if (exact.version !== 0 || sealedLookups.size === 0) return { ok: false, code: "SIGNED_MISMATCH", index };
      if (!exact.message.addressTableLookups.every((lookup) => sealedLookups.has(lookup.accountKey.toBase58()))) return { ok: false, code: "SIGNED_MISMATCH", index };
    }
    const transaction = decodeWire(wire, tables);
    if (!transaction) return { ok: false, code: "SIGNED_MISMATCH", index };
    if (reviewedDigest(transaction) !== ticket.messages[index] || !walletAdditionsAllowed(transaction)) return { ok: false, code: "SIGNED_MISMATCH", index };
    if (transaction.feePayer?.toBase58() !== ticket.owner) return { ok: false, code: "SIGNED_MISMATCH", index };
    /* The fresh keys sign after the wallet, over the exact message the wallet signed. */
    const mine = cosigners.filter((cosigner) => cosigner.index === index).map((cosigner) => cosigner.key);
    try {
      if (mine.length) exact.sign(mine);
    } catch {
      return { ok: false, code: "SIGNED_MISMATCH", index };
    }
    /* Every signature real over these bytes: the wallet's and each fresh key's. */
    const message = exact.message.serialize();
    const required = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
    const allReal = required.every((signer, at) => {
      const signature = exact.signatures[at];
      return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signer);
    });
    if (!allReal) return { ok: false, code: "NOT_SIGNED", index };
    signatures.push(base58(exact.signatures[0]!));
    wires.push(Buffer.from(exact.serialize()).toString("base64"));
  }
  return { ok: true, signatures, wires };
}

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO = new Set(["MemoSq4gqABAXKb96qnH8TyNMKSDgWgN2ub7ZM4eE6h", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);

/**
 * What a pool action may do besides the venue's own instructions, and nothing else: open the wallet's own token
 * accounts on its own rent, wrap SOL into its own wrapped-SOL account and close that account back to itself, set the
 * compute budget, write a memo. A transfer to anyone, an approval or a change of authority is refused.
 */
function plumbingAllowed(instruction: TransactionInstruction, owner: string, ownWrappedSol: string): boolean {
  const program = instruction.programId.toBase58();
  const data = Buffer.from(instruction.data);
  const keys = instruction.keys.map((key) => key.pubkey.toBase58());
  if (program === COMPUTE_BUDGET || MEMO.has(program)) return true;
  /* Create (no data) or create-idempotent (1): payer and wallet are the owner. */
  if (program === ATA) return (data.length === 0 || (data.length === 1 && data[0] === 1)) && keys[0] === owner && keys[2] === owner;
  /* Transfer (2) of lamports from the owner to the owner's own wrapped-SOL account. */
  if (program === SYSTEM) return data.length === 12 && data.readUInt32LE(0) === 2 && keys[0] === owner && keys[1] === ownWrappedSol;
  if (program === TOKEN || program === TOKEN_2022) {
    /* SyncNative (17) of the own wrapped-SOL account; CloseAccount (9) of it back to the owner, by the owner. */
    if (data.length === 1 && data[0] === 17) return keys[0] === ownWrappedSol;
    if (data.length === 1 && data[0] === 9) return keys[0] === ownWrappedSol && keys[1] === owner && keys[2] === owner;
    return false;
  }
  return false;
}

/**
 * A built transaction before it is shown: paid for by the wallet, calling the venue's program and the wallet's own
 * token-account plumbing only, with a compute budget the relay will accept. Anything else means the build is not the
 * action Review describes — it is refused, never shown.
 */
export function builtCallsOnly(wireBase64: string, owner: string, venueProgram: string): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(wireBase64, "base64"));
  } catch {
    return { ok: false, reason: "The built transaction could not be read." };
  }
  if (transaction.feePayer?.toBase58() !== owner) return { ok: false, reason: "The built transaction is paid by someone other than the wallet." };
  const ownWrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(owner), true).toBase58();
  for (const instruction of transaction.instructions) {
    const program = instruction.programId.toBase58();
    if (program === venueProgram) continue;
    if (!plumbingAllowed(instruction, owner, ownWrappedSol)) return { ok: false, reason: `The built transaction has an instruction of ${program} outside the action.` };
  }
  if (!budgetAllowed(transaction)) return { ok: false, reason: "The built transaction's compute budget is outside what the relay accepts." };
  if (!transaction.instructions.some((instruction) => instruction.programId.toBase58() === venueProgram)) return { ok: false, reason: "The built transaction does not call the venue." };
  return { ok: true };
}
