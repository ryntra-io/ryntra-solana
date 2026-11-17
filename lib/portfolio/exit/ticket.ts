/**
 * The seal between an exit's Review and its relay.
 *
 * The same rule as every action of the engine that a wallet signs: the Review builds the transactions and hands back a
 * ticket — the wallet, and for each transaction what it is, which position or coin it acts on, the digest of what it
 * does, the lookup tables it names, the order it answers on Jupiter's managed lane, and which transactions must have
 * landed before it may be sent — signed with the server's key. The relay sends only bytes that do exactly that, paid
 * for by that wallet. Reading the signed bytes back is the wallet clean's own check (`lib/wallet-clean/ticket.ts`), used
 * as it is: a wallet may add its assertions and a compute budget when it signs, nothing else.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { AddressLookupTableAccount } from "@solana/web3.js";

import { TICKET_KEY_ENV, TICKET_TTL_MS } from "../../liquidity/studio/ticket.ts";
import { checkCleanSigned, lookupsOf, stepDigest, type CleanSigned } from "../../wallet-clean/ticket.ts";
import { EXIT_MODES, type ExitMode } from "./model.ts";
import { EXIT_STEP_KINDS, type ExitStepKind } from "./steps.ts";

const PURPOSE = "portfolio-exit.review.v1";

/** The most transactions one approval carries. */
export const MAX_EXIT_STEPS = 16;
/** The most lookup tables one transaction may name. */
export const MAX_STEP_LOOKUPS = 8;

export { EXIT_STEP_KINDS, type ExitStepKind };

type Env = Readonly<Record<string, string | undefined>>;

export type ExitStep = Readonly<{
  kind: ExitStepKind;
  /** The position's id in the portfolio, or for a sweep the mint it swaps. */
  ref: string;
  digest: string;
  lookups: readonly string[];
  /** A swap on Jupiter's managed lane: the order its bytes answer, sent through `/execute`; null — the deployment's own RPC. */
  requestId: string | null;
  /** Steps (their places) that must all have landed before this one is sent. */
  all: readonly number[];
  /** Steps of which at least one must have landed, when any are named. */
  any: readonly number[];
  /**
   * A fixed swap of SOL: the lamports the wallet must hold when it is sent — what it held at the Review and what the swap
   * wraps. Less means the SOL did not arrive, and the swap would spend the wallet's own: it is not sent. Null — any other step.
   */
  needLamports: string | null;
}>;

export type ExitTicket = Readonly<{ v: 1; owner: string; mode: ExitMode; steps: readonly ExitStep[]; issuedAt: number; expiresAt: number }>;

const secretOf = (env: Env): string | null => {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
};
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export const exitTicketKeyHere = (env: Env): boolean => secretOf(env) !== null;

export function issueExitTicket(input: Readonly<{ owner: string; mode: ExitMode; steps: readonly ExitStep[] }>, env: Env, now = Date.now(), ttlMs = TICKET_TTL_MS): string | null {
  const secret = secretOf(env);
  if (!secret || input.steps.length === 0 || input.steps.length > MAX_EXIT_STEPS) return null;
  const ticket: ExitTicket = { v: 1, owner: input.owner, mode: input.mode, steps: input.steps, issuedAt: now, expiresAt: now + Math.max(0, Math.min(ttlMs, TICKET_TTL_MS)) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

const isAddress = (value: unknown): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

/** Places of earlier steps only: a step never waits for itself or for one after it. */
const placesBefore = (value: unknown, index: number): value is number[] => Array.isArray(value) && value.length <= MAX_EXIT_STEPS && value.every((at) => Number.isInteger(at) && at >= 0 && at < index);

function stepValid(value: unknown, index: number): value is ExitStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<ExitStep>;
  return (
    typeof step.kind === "string" &&
    (EXIT_STEP_KINDS as readonly string[]).includes(step.kind) &&
    typeof step.ref === "string" &&
    step.ref.length > 0 &&
    step.ref.length <= 160 &&
    typeof step.digest === "string" &&
    /^[0-9a-f]{64}$/.test(step.digest) &&
    Array.isArray(step.lookups) &&
    step.lookups.length <= MAX_STEP_LOOKUPS &&
    step.lookups.every(isAddress) &&
    (step.requestId === null || (typeof step.requestId === "string" && step.requestId.length > 0 && step.requestId.length <= 256 && step.kind === "swap")) &&
    placesBefore(step.all, index) &&
    placesBefore(step.any, index) &&
    (step.needLamports === null || (typeof step.needLamports === "string" && /^\d{1,20}$/.test(step.needLamports) && step.kind === "sweep"))
  );
}

export type ExitTicketRead = Readonly<{ ok: true; ticket: ExitTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

export function readExitTicket(value: unknown, env: Env, now = Date.now()): ExitTicketRead {
  const secret = secretOf(env);
  if (!secret || typeof value !== "string" || value.length > 32_768) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<ExitTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ExitTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    !isAddress(parsed.owner) ||
    typeof parsed.mode !== "string" ||
    !(EXIT_MODES as readonly string[]).includes(parsed.mode) ||
    !Array.isArray(parsed.steps) ||
    parsed.steps.length === 0 ||
    parsed.steps.length > MAX_EXIT_STEPS ||
    !parsed.steps.every(stepValid) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as ExitTicket };
}

/**
 * The wallet's signed bytes against the ticket: as many as were built, each doing what its digest says in its own
 * place, paid for by the ticket's wallet, with the wallet's signature real — the wallet clean's check, step for step.
 */
export function checkExitSigned(ticket: ExitTicket, signed: readonly unknown[], tables: ReadonlyMap<string, AddressLookupTableAccount>): CleanSigned {
  return checkCleanSigned(
    {
      v: 1,
      owner: ticket.owner,
      steps: ticket.steps.map((step) => ({ kind: step.requestId === null ? ("close" as const) : ("swap" as const), digest: step.digest, lookups: step.lookups, requestId: step.requestId })),
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
    },
    signed,
    tables,
  );
}

export { TICKET_TTL_MS, lookupsOf, stepDigest };
