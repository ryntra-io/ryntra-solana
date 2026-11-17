/**
 * «Clean the wallet» — the seal between a Review and its relay.
 *
 * The same rule as every pool action of the engine (`lib/liquidity/studio/ticket.ts`, whose reading of a transaction
 * this file uses as it is): the Review builds the transactions and hands back a ticket — the wallet, and for each
 * transaction what it is (a close, a swap, the close after the swaps), the digest of what it does, the lookup tables
 * it names and, for a swap on Jupiter's managed lane, the order it answers — signed with the server's key. The relay
 * sends only bytes that do exactly that, in that place, paid for by that wallet. A wallet may add Lighthouse
 * assertions and compute-budget settings when it signs; nothing else.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { VersionedTransaction, type AddressLookupTableAccount } from "@solana/web3.js";

import { TICKET_KEY_ENV, TICKET_TTL_MS, decodeWire, reviewedDigest, walletAdditionsAllowed } from "../liquidity/studio/ticket.ts";
import { base58 } from "../solana/limits/model.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { STEP_KINDS, type StepKind } from "./steps.ts";

const PURPOSE = "wallet-clean.review.v1";
/** The most transactions one approval carries: the closes, the swaps, the close after them. */
export const MAX_TICKET_STEPS = 10;
export { STEP_KINDS, type StepKind };

type Env = Readonly<Record<string, string | undefined>>;

export type CleanStep = Readonly<{
  kind: StepKind;
  /** The digest of what the transaction does, hex. */
  digest: string;
  /** The lookup tables its message names, in order. */
  lookups: readonly string[];
  /** A swap on Jupiter's managed lane: the order its bytes answer, sent through `/execute`; null — the deployment's own RPC. */
  requestId: string | null;
}>;

export type CleanTicket = Readonly<{
  v: 1;
  owner: string;
  steps: readonly CleanStep[];
  issuedAt: number;
  expiresAt: number;
}>;

const secretOf = (env: Env): string | null => {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
};
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export const cleanTicketKeyHere = (env: Env): boolean => secretOf(env) !== null;

/** The digest of a built transaction with its tables; null for bytes that cannot be read. */
export function stepDigest(wireBase64: string, tables: readonly AddressLookupTableAccount[] = []): string | null {
  const decoded = decodeWire(wireBase64, tables);
  return decoded ? reviewedDigest(decoded) : null;
}

/** The lookup tables a wire names, in its own order; null for bytes that cannot be read. */
export function lookupsOf(wireBase64: string): string[] | null {
  try {
    const exact = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
    return exact.version === 0 ? exact.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58()) : [];
  } catch {
    return null;
  }
}

export function issueCleanTicket(input: Readonly<{ owner: string; steps: readonly CleanStep[] }>, env: Env, now = Date.now(), ttlMs = TICKET_TTL_MS): string | null {
  const secret = secretOf(env);
  if (!secret || input.steps.length === 0 || input.steps.length > MAX_TICKET_STEPS) return null;
  const ticket: CleanTicket = { v: 1, owner: input.owner, steps: input.steps, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type CleanTicketRead = Readonly<{ ok: true; ticket: CleanTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

const isAddress = (value: unknown): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

function stepValid(value: unknown): value is CleanStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<CleanStep>;
  return (
    typeof step.kind === "string" &&
    (STEP_KINDS as readonly string[]).includes(step.kind) &&
    typeof step.digest === "string" &&
    /^[0-9a-f]{64}$/.test(step.digest) &&
    Array.isArray(step.lookups) &&
    step.lookups.length <= 8 &&
    step.lookups.every(isAddress) &&
    (step.requestId === null || (typeof step.requestId === "string" && step.requestId.length > 0 && step.requestId.length <= 256 && step.kind === "swap"))
  );
}

export function readCleanTicket(value: unknown, env: Env, now = Date.now()): CleanTicketRead {
  const secret = secretOf(env);
  if (!secret || typeof value !== "string" || value.length > 16_384) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<CleanTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CleanTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    !isAddress(parsed.owner) ||
    !Array.isArray(parsed.steps) ||
    parsed.steps.length === 0 ||
    parsed.steps.length > MAX_TICKET_STEPS ||
    !parsed.steps.every(stepValid) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as CleanTicket };
}

export type CleanSigned = Readonly<{ ok: true; signatures: readonly string[]; wires: readonly string[] }> | Readonly<{ ok: false; code: "SIGNED_MISMATCH" | "NOT_SIGNED"; index: number }>;

/**
 * The wallet's bytes against the ticket: as many as were built, each doing what its digest says in its own place, paid
 * for by the ticket's wallet, with nothing added but what a wallet may add, and the wallet's own signature real. A
 * swap on Jupiter's managed lane may carry a market maker's place still empty: Jupiter fills it on `/execute`.
 */
export function checkCleanSigned(ticket: CleanTicket, signed: readonly unknown[], tables: ReadonlyMap<string, AddressLookupTableAccount>): CleanSigned {
  if (signed.length !== ticket.steps.length) return { ok: false, code: "SIGNED_MISMATCH", index: Math.min(signed.length, ticket.steps.length) };
  const signatures: string[] = [];
  const wires: string[] = [];
  for (let index = 0; index < signed.length; index += 1) {
    const wire = signed[index];
    const step = ticket.steps[index]!;
    if (typeof wire !== "string" || wire.length > 4_096) return { ok: false, code: "SIGNED_MISMATCH", index };
    let exact: VersionedTransaction;
    try {
      exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "SIGNED_MISMATCH", index };
    }
    const lookups = exact.version === 0 ? exact.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58()) : [];
    if (lookups.length !== step.lookups.length || lookups.some((key, at) => key !== step.lookups[at])) return { ok: false, code: "SIGNED_MISMATCH", index };
    const own = lookups.map((key) => tables.get(key));
    if (own.some((table) => !table)) return { ok: false, code: "SIGNED_MISMATCH", index };
    const transaction = decodeWire(wire, own as AddressLookupTableAccount[]);
    if (!transaction) return { ok: false, code: "SIGNED_MISMATCH", index };
    if (reviewedDigest(transaction) !== step.digest || !walletAdditionsAllowed(transaction)) return { ok: false, code: "SIGNED_MISMATCH", index };
    if (transaction.feePayer?.toBase58() !== ticket.owner) return { ok: false, code: "SIGNED_MISMATCH", index };
    const message = exact.message.serialize();
    const keys = exact.message.staticAccountKeys;
    const at = keys.findIndex((key) => key.toBase58() === ticket.owner);
    const own0 = exact.signatures[at];
    if (at < 0 || !own0 || !own0.some((byte) => byte !== 0) || !ed25519Valid(message, own0, keys[at]!)) return { ok: false, code: "NOT_SIGNED", index };
    // Outside Jupiter's managed lane every other signer must have signed too.
    if (step.requestId === null) {
      const required = keys.slice(0, exact.message.header.numRequiredSignatures);
      const allReal = required.every((signer, position) => {
        const signature = exact.signatures[position];
        return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signer);
      });
      if (!allReal) return { ok: false, code: "NOT_SIGNED", index };
    }
    signatures.push(base58(own0));
    wires.push(Buffer.from(exact.serialize()).toString("base64"));
  }
  return { ok: true, signatures, wires };
}

export { TICKET_TTL_MS };
