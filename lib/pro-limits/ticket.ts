/**
 * The seal between what a person was shown and what the relay sends — the pool actions' own seal
 * (`lib/liquidity/studio/ticket.ts`), for this lane's version-0 bytes.
 *
 * A Review builds the transactions, shows what they do and hands back a ticket: the wallet, the action, the network,
 * and a digest of what each transaction does, signed with the server's key. The relay sends only bytes that do exactly
 * that, in that order, paid for by that wallet. What a transaction does — its payer, its blockhash, its instructions —
 * and what a wallet may add when it signs are the studio's own rules, used as they are.
 *
 * The wallet signs first. Placing an order needs a second signature — the fresh key the order's NFT is minted at, a
 * key that holds nothing — and a wallet refuses bytes someone has signed already. So the ticket carries that key
 * sealed with the server's, and the relay signs with it after the wallet, over the exact message the wallet signed.
 *
 * A ticket lives as long as its bytes' blockhash. Without the server's key nothing is built for anyone.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { VersionedTransaction } from "@solana/web3.js";

import { TICKET_KEY_ENV, TICKET_TTL_MS, decodeWire, openCosigners, reviewedDigest, sealCosigners, walletAdditionsAllowed, type Cosigner } from "../liquidity/studio/ticket.ts";
import { base58 } from "../solana/limits/model.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";

import type { ProLimitsNetwork } from "./gate.ts";

const PURPOSE = "pro-limits.review.v1";
export const PRO_ACTIONS = ["place", "collect", "close", "delegate"] as const;
export type ProAction = (typeof PRO_ACTIONS)[number];

type Env = Readonly<Record<string, string | undefined>>;

export type ProTicket = Readonly<{
  v: 1;
  network: ProLimitsNetwork;
  owner: string;
  action: ProAction;
  pool: string;
  nftMint: string;
  /** The digest of what each transaction does, hex, in the order they are signed and sent. */
  messages: readonly string[];
  /** The fresh key the relay signs with after the wallet, sealed; null when the wallet is the only signer. */
  cosign: string | null;
  issuedAt: number;
  expiresAt: number;
}>;

const keyOf = (env: Env): string | null => {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
};
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

/** The digest of a built transaction; null when the bytes cannot be read. */
export function proDigest(wireBase64: string): string | null {
  const decoded = decodeWire(wireBase64);
  return decoded ? reviewedDigest(decoded) : null;
}

export function issueProTicket(input: Omit<ProTicket, "v" | "issuedAt" | "expiresAt" | "cosign"> & Readonly<{ cosigners: readonly Cosigner[] }>, env: Env, now: number, ttlMs = TICKET_TTL_MS): string | null {
  const secret = keyOf(env);
  if (!secret) return null;
  const { cosigners, ...rest } = input;
  const cosign = cosigners.length ? sealCosigners(cosigners, env) : null;
  if (cosigners.length && cosign === null) return null;
  const ticket: ProTicket = { v: 1, ...rest, cosign, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type ProTicketRead = Readonly<{ ok: true; ticket: ProTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

const isAddress = (value: unknown): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

export function readProTicket(value: unknown, env: Env, now: number): ProTicketRead {
  const secret = keyOf(env);
  if (!secret || typeof value !== "string" || value.length > 8192) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<ProTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ProTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    (parsed.network !== "devnet" && parsed.network !== "mainnet") ||
    !isAddress(parsed.owner) ||
    !PRO_ACTIONS.includes(parsed.action as ProAction) ||
    !isAddress(parsed.pool) ||
    !isAddress(parsed.nftMint) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length === 0 ||
    parsed.messages.length > 4 ||
    !parsed.messages.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) ||
    !(parsed.cosign === null || (typeof parsed.cosign === "string" && parsed.cosign.length <= 4096)) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as ProTicket };
}

export type ProSigned = Readonly<{ ok: true; signatures: readonly string[]; wires: readonly string[] }> | Readonly<{ ok: false; code: "SIGNED_MISMATCH" | "NOT_SIGNED" | "TICKET_INVALID"; index: number }>;

/**
 * The wallet's bytes against the ticket: as many as were built, each doing what its digest says in its own place, paid
 * for by the ticket's wallet, version 0 with no lookup table, anything the wallet added within the studio's rules. The
 * ticket's fresh key then signs over the exact message the wallet signed, and every signature must be real.
 */
export function checkProSigned(ticket: ProTicket, signed: readonly unknown[], env: Env): ProSigned {
  const cosigners = openCosigners(ticket.cosign, env);
  if (!cosigners) return { ok: false, code: "TICKET_INVALID", index: 0 };
  if (signed.length !== ticket.messages.length) return { ok: false, code: "SIGNED_MISMATCH", index: Math.min(signed.length, ticket.messages.length) };
  const signatures: string[] = [];
  const wires: string[] = [];
  for (let index = 0; index < signed.length; index += 1) {
    const wire = signed[index];
    if (typeof wire !== "string" || wire.length > 4096) return { ok: false, code: "SIGNED_MISMATCH", index };
    let exact: VersionedTransaction;
    try {
      exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "SIGNED_MISMATCH", index };
    }
    if (exact.version !== 0 || exact.message.addressTableLookups.length > 0) return { ok: false, code: "SIGNED_MISMATCH", index };
    const transaction = decodeWire(wire);
    if (!transaction || reviewedDigest(transaction) !== ticket.messages[index] || !walletAdditionsAllowed(transaction)) return { ok: false, code: "SIGNED_MISMATCH", index };
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
