/**
 * The seal between a Review of a DLMM Pro action and its relay.
 *
 * The same rule as every pool action of the engine (`lib/liquidity/studio/ticket.ts`, whose reading of a transaction
 * this file uses as it is): a Review builds the transactions and hands back a ticket — the wallet, the action, and a
 * digest of what each transaction does, signed with the server's key. The relay sends only bytes that do exactly that,
 * in that order, paid for by that wallet. A wallet may add Lighthouse assertions and compute-budget settings when it
 * signs; nothing else.
 *
 * The wallet signs first. Opening a position needs one more signature — the fresh key its NFT is minted at, a key that
 * holds nothing — so the ticket carries that key sealed, and the relay signs with it after the wallet, over the exact
 * message the wallet signed.
 *
 * A DLMM Pro build is a version-0 message with no lookup table; a signed transaction that names one is refused.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { VersionedTransaction } from "@solana/web3.js";

import { TICKET_KEY_ENV, TICKET_TTL_MS, decodeWire, openCosigners, reviewedDigest, sealCosigners, walletAdditionsAllowed, type Cosigner } from "../liquidity/studio/ticket.ts";
import { base58 } from "../solana/limits/model.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { EARN_PRO_ACTIONS, type EarnProAction, type EarnProNetwork } from "./gate.ts";

const PURPOSE = "earn-pro.review.v1";
/** The most transactions one approval carries: a swap, the opening, and the opening's second call for a wide shape. */
export const MAX_TICKET_MESSAGES = 6;

type Env = Readonly<Record<string, string | undefined>>;

export type EarnProTicket = Readonly<{
  v: 1;
  network: EarnProNetwork;
  owner: string;
  action: EarnProAction;
  pool: string;
  nftMint: string;
  /** The digest of what each transaction does, hex, in the order they are signed and sent. */
  messages: readonly string[];
  /** The fresh key the relay signs with after the wallet, sealed; null when the wallet is the only signer. */
  cosign: string | null;
  /** A care's stop the person chose, token Y per token X; only on `care_on`. */
  stopBelow: number | null;
  issuedAt: number;
  expiresAt: number;
}>;

const secretOf = (env: Env): string | null => {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
};
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export const ticketKeyHere = (env: Env): boolean => secretOf(env) !== null;

/** The digest of a built, unsigned transaction; null for bytes that cannot be read. */
export function digestOf(wireBase64: string): string | null {
  const decoded = decodeWire(wireBase64);
  return decoded ? reviewedDigest(decoded) : null;
}

export function issueEarnProTicket(input: Omit<EarnProTicket, "v" | "issuedAt" | "expiresAt">, env: Env, now = Date.now(), ttlMs = TICKET_TTL_MS): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const ticket: EarnProTicket = { v: 1, ...input, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type EarnProTicketRead = Readonly<{ ok: true; ticket: EarnProTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

const isAddress = (value: unknown): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

export function readEarnProTicket(value: unknown, env: Env, now = Date.now()): EarnProTicketRead {
  const secret = secretOf(env);
  if (!secret || typeof value !== "string" || value.length > 8_192) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<EarnProTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<EarnProTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    (parsed.network !== "devnet" && parsed.network !== "mainnet") ||
    !isAddress(parsed.owner) ||
    typeof parsed.action !== "string" ||
    !(EARN_PRO_ACTIONS as readonly string[]).includes(parsed.action) ||
    !isAddress(parsed.pool) ||
    !isAddress(parsed.nftMint) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length === 0 ||
    parsed.messages.length > MAX_TICKET_MESSAGES ||
    !parsed.messages.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) ||
    !(parsed.cosign === null || (typeof parsed.cosign === "string" && parsed.cosign.length <= 4_096)) ||
    !(parsed.stopBelow === null || (typeof parsed.stopBelow === "number" && Number.isFinite(parsed.stopBelow) && parsed.stopBelow > 0)) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as EarnProTicket };
}

export type EarnProSigned = Readonly<{ ok: true; signatures: readonly string[]; wires: readonly string[] }> | Readonly<{ ok: false; code: "SIGNED_MISMATCH" | "NOT_SIGNED"; index: number }>;

/**
 * The wallet's bytes against the ticket: as many as were built, each doing what its digest says in its own place, paid
 * for by the ticket's wallet, with nothing added but what a wallet may add and no signer the build did not name. The
 * ticket's fresh key then signs over the exact message the wallet signed, and every signature must be real.
 */
export function checkEarnProSigned(ticket: EarnProTicket, signed: readonly unknown[], cosigners: readonly Cosigner[]): EarnProSigned {
  if (signed.length !== ticket.messages.length) return { ok: false, code: "SIGNED_MISMATCH", index: Math.min(signed.length, ticket.messages.length) };
  const signatures: string[] = [];
  const wires: string[] = [];
  for (let index = 0; index < signed.length; index += 1) {
    const wire = signed[index];
    if (typeof wire !== "string" || wire.length > 4_096) return { ok: false, code: "SIGNED_MISMATCH", index };
    let exact: VersionedTransaction;
    try {
      exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "SIGNED_MISMATCH", index };
    }
    if (exact.version !== 0 || exact.message.addressTableLookups.length > 0) return { ok: false, code: "SIGNED_MISMATCH", index };
    const transaction = decodeWire(wire);
    if (!transaction) return { ok: false, code: "SIGNED_MISMATCH", index };
    if (reviewedDigest(transaction) !== ticket.messages[index] || !walletAdditionsAllowed(transaction)) return { ok: false, code: "SIGNED_MISMATCH", index };
    if (transaction.feePayer?.toBase58() !== ticket.owner) return { ok: false, code: "SIGNED_MISMATCH", index };
    const mine = cosigners.filter((cosigner) => cosigner.index === index).map((cosigner) => cosigner.key);
    try {
      if (mine.length) exact.sign(mine);
    } catch {
      return { ok: false, code: "SIGNED_MISMATCH", index };
    }
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

export { openCosigners, sealCosigners, TICKET_TTL_MS, type Cosigner };
