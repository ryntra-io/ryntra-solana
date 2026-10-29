/**
 * The seal on an Earn Review, and the reading of the bytes that come back signed.
 *
 * The problem a ticket solves: a Review is built on one server call and the signed bytes arrive on another,
 * with a browser in between. Without something sealed, the submit lane would have to believe the browser
 * about what was reviewed — the amount, the market, the rate on screen — and «believe the client» is the one
 * thing a money path may never do.
 *
 * So the Review hands back a ticket: its own facts, with a MAC over them from a secret only this server has
 * (`BETA_TOKEN_SECRET`, the same secret the collateral and pool lanes seal their tickets with — this adds no
 * new secret to anybody's deployment). The ticket carries no secret of its own and no key: the wallet is the
 * only signer, and the ticket is a statement of what was shown, not a permission to sign.
 *
 * The purpose string keeps the lanes apart — a pool's ticket is not an Earn ticket and will not read as one —
 * and the ticket's life is the blockhash's, because a Review whose bytes can no longer land is not a Review
 * worth relaying.
 *
 * Where the secret is absent, no ticket is issued and the write lane is honestly closed rather than quietly
 * unsealed: {@link earnTicketKeyConfigured} is what a surface asks before offering the action.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { PublicKey, VersionedTransaction } from "@solana/web3.js";

import { BLOCKHASH_LIFE_MS } from "../solana/blockhash-life.ts";
import { base58 } from "../solana/limits/model.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";

import { EARN_PROVIDER_IDS, WALLET_ADDRESS, type EarnAction, type EarnProviderId } from "./model.ts";
import type { Env } from "./providers.ts";

export const TICKET_KEY_ENV = "BETA_TOKEN_SECRET";
const PURPOSE = "earn.lend.v1";
export const EARN_TICKET_TTL_MS = BLOCKHASH_LIFE_MS;

const DIGITS = /^\d{1,32}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type EarnTicket = Readonly<{
  v: 1;
  provider: EarnProviderId;
  owner: string;
  action: EarnAction;
  /** The market's id — on Jupiter Lend the asset's mint, which is what the provider's calls take. */
  market: string;
  /** What will move, base units, as the Review showed it. */
  amount: string;
  /** The asset's decimals, so the submit lane can price the amount without asking the provider twice. */
  decimals: number;
  /** The rate on the screen the person signed, per cent a year; null when none was stated. */
  rate: number | null;
  /** sha256 of the transaction message the wallet was asked to sign. */
  message: string;
  issuedAt: number;
  expiresAt: number;
}>;

function secretOf(env: Env): string | null {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export const earnTicketKeyConfigured = (env: Env): boolean => secretOf(env) !== null;

/** The sha256 of the message bytes a wallet is asked to sign — the seal's whole content. */
export function messageDigestOf(wireBase64: string): string | null {
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
    return createHash("sha256").update(Buffer.from(transaction.message.serialize())).digest("hex");
  } catch {
    return null;
  }
}

export function issueEarnTicket(
  input: Omit<EarnTicket, "v" | "issuedAt" | "expiresAt">,
  env: Env,
  now = Date.now(),
  ttlMs = EARN_TICKET_TTL_MS,
): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const ticket: EarnTicket = { v: 1, ...input, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, EARN_TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type EarnTicketRead = Readonly<{ ok: true; ticket: EarnTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

export function readEarnTicket(value: unknown, env: Env, now = Date.now()): EarnTicketRead {
  const secret = secretOf(env);
  if (!secret || typeof value !== "string" || value.length > 4096) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<EarnTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<EarnTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    typeof parsed.provider !== "string" ||
    !(EARN_PROVIDER_IDS as readonly string[]).includes(parsed.provider) ||
    typeof parsed.owner !== "string" ||
    !WALLET_ADDRESS.test(parsed.owner) ||
    (parsed.action !== "deposit" && parsed.action !== "withdraw") ||
    typeof parsed.market !== "string" ||
    !WALLET_ADDRESS.test(parsed.market) ||
    typeof parsed.amount !== "string" ||
    !DIGITS.test(parsed.amount) ||
    typeof parsed.decimals !== "number" ||
    !Number.isInteger(parsed.decimals) ||
    parsed.decimals < 0 ||
    parsed.decimals > 18 ||
    !(parsed.rate === null || (typeof parsed.rate === "number" && Number.isFinite(parsed.rate))) ||
    typeof parsed.message !== "string" ||
    !SHA256.test(parsed.message) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  /* A ticket from the future is a forged or mis-clocked one; a minute of slack covers a server's own drift. */
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as EarnTicket };
}

export type EarnSignedCheck =
  | Readonly<{ ok: true; signature: string; wire: string }>
  | Readonly<{ ok: false; code: "SIGNED_MISMATCH" | "NOT_SIGNED" }>;

/**
 * The wallet's bytes against the ticket.
 *
 * Three questions, and all three have to answer yes. Are these the bytes the Review showed — the message's
 * digest against the seal, which is the whole point of the seal. Is the fee payer the wallet the Review was
 * built for. Is every required signature a real ed25519 signature over this exact message, so an empty
 * 64-byte placeholder cannot travel as a signature.
 *
 * A versioned transaction is not re-assembled here and nothing is added to it: the signer is handed bytes and
 * returns the same bytes signed, so anything that changed is a mismatch rather than something to accommodate.
 */
export function checkEarnSigned(ticket: Pick<EarnTicket, "owner" | "message">, signed: unknown): EarnSignedCheck {
  if (typeof signed !== "string" || signed.length > 8192) return { ok: false, code: "SIGNED_MISMATCH" };
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
  } catch {
    return { ok: false, code: "SIGNED_MISMATCH" };
  }
  const message = Buffer.from(transaction.message.serialize());
  if (createHash("sha256").update(message).digest("hex") !== ticket.message) return { ok: false, code: "SIGNED_MISMATCH" };
  const payer = transaction.message.staticAccountKeys[0];
  if (!payer || payer.toBase58() !== ticket.owner) return { ok: false, code: "SIGNED_MISMATCH" };
  const required = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures);
  const allReal =
    required.length > 0 &&
    required.every((signer: PublicKey, at: number) => {
      const signature = transaction.signatures[at];
      return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signer);
    });
  if (!allReal) return { ok: false, code: "NOT_SIGNED" };
  return { ok: true, signature: base58(transaction.signatures[0]!), wire: Buffer.from(transaction.serialize()).toString("base64") };
}
