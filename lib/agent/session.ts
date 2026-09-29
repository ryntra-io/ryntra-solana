/**
 * The durable conversation (`RYN-AGENT-TEXT-001`; the Owner's rule of
 * 2026-09-22 §11).
 *
 * One record per session in the Guard store, keyed by the proven wallet and
 * read back only through that proof — the same tenancy every other cabinet
 * collection keeps (canon §0.6): `solana:mainnet:<wallet>:<sessionId>`, the
 * trailing colon on the scan prefix so one wallet's scan never reads a
 * wallet whose address starts the same way. The turns are structured — the
 * person's words, Ryn's answer with its cards and citations — and they are a
 * record of what was said, never the source of a balance, a plan's state, an
 * order's state or the inbox: those are read again through the tools on
 * every question. Compare-and-set on the store's revision keeps two answers
 * to one session from overwriting each other; the loser re-reads.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  AGENT_SESSION_ID,
  AGENT_TURNS_KEPT,
  AgentContextSchema,
  AgentTurnSchema,
  BASE58,
  NETWORK,
  type AgentContext,
  type AgentSession,
  type AgentTurn,
} from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";

const COLLECTION = "agentSessions" as const;

/** How many sessions a wallet keeps; the oldest beyond it are not read back. */
export const SESSIONS_KEPT = 20;

export const AgentSessionRecordSchema = z
  .object({
    schema: z.literal("ryntra.agent-session"),
    schemaVersion: z.literal("1.0.0"),
    /** The store's revision — the compare-and-set counter. */
    version: z.number().int().min(1),
    id: z.string().regex(AGENT_SESSION_ID),
    owner: z.string().regex(BASE58),
    network: z.literal(NETWORK),
    locale: z.enum(["en", "uk"]),
    context: AgentContextSchema.nullable(),
    turns: z.array(AgentTurnSchema).max(AGENT_TURNS_KEPT),
    /** How many turns the session made in all, including those no longer kept. */
    turnCount: z.number().int().min(0),
    /** Privacy-safe product steps this session recorded, by name, with counts — never words. */
    steps: z.record(z.string().min(1).max(48), z.number().int().min(0)),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AgentSessionRecord = z.output<typeof AgentSessionRecordSchema>;

export function newSessionId(): string {
  return `ags_${randomBytes(16).toString("hex")}`;
}

export function newTurnId(): string {
  return `agt_${randomBytes(12).toString("hex")}`;
}

export function sessionKey(owner: string, sessionId: string): string {
  return `solana:mainnet:${owner}:${sessionId}`;
}

export function sessionPrefix(owner: string): string {
  return `solana:mainnet:${owner}:`;
}

function versioned(store: GuardStore) {
  return store.versioned<AgentSessionRecord>(COLLECTION);
}

/** The record as the contract states a session — the kept turns, nothing of the store's bookkeeping. */
export function projectSession(record: AgentSessionRecord): AgentSession {
  return { id: record.id, owner: record.owner, network: record.network, locale: record.locale, context: record.context, turns: record.turns, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

export async function readSession(store: GuardStore, owner: string, sessionId: string): Promise<AgentSessionRecord | null> {
  if (!BASE58.test(owner) || !AGENT_SESSION_ID.test(sessionId)) return null;
  const raw = await versioned(store).get(sessionKey(owner, sessionId));
  if (raw === undefined || raw === null) return null;
  const parsed = AgentSessionRecordSchema.safeParse(raw);
  /* A record of another wallet under this key cannot exist by construction; the check is the boundary said twice. */
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

/** The wallet's sessions, most recently updated first. */
export async function listSessions(store: GuardStore, owner: string): Promise<readonly AgentSessionRecord[]> {
  if (!BASE58.test(owner)) return [];
  const values = await versioned(store).valuesWithPrefix(sessionPrefix(owner));
  return values
    .map((value) => AgentSessionRecordSchema.safeParse(value))
    .filter((parsed): parsed is { success: true; data: AgentSessionRecord } => parsed.success && parsed.data.owner === owner)
    .map((parsed) => parsed.data)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, SESSIONS_KEPT);
}

function sameContext(a: AgentContext | null, b: AgentContext | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Open a session: the one named, else the wallet's latest for the same
 * context, else a new one. A session is never shared: the id must be the
 * wallet's own, and an id of another wallet is simply not found.
 */
export async function openSession(
  store: GuardStore,
  input: Readonly<{ owner: string; locale: "en" | "uk"; context: AgentContext | null; sessionId?: string; nowMs: number; newId?: () => string }>,
): Promise<Readonly<{ ok: true; record: AgentSessionRecord; opened: boolean }> | Readonly<{ ok: false; code: "AGENT_SESSION_NOT_FOUND" | "UNAVAILABLE" }>> {
  if (input.sessionId) {
    const found = await readSession(store, input.owner, input.sessionId);
    if (!found) return { ok: false, code: "AGENT_SESSION_NOT_FOUND" };
    return { ok: true, record: found, opened: false };
  }
  const existing = (await listSessions(store, input.owner)).find((record) => sameContext(record.context, input.context) && record.locale === input.locale);
  if (existing) return { ok: true, record: existing, opened: false };
  const at = new Date(input.nowMs).toISOString();
  const record: AgentSessionRecord = {
    schema: "ryntra.agent-session",
    schemaVersion: "1.0.0",
    version: 1,
    id: (input.newId ?? newSessionId)(),
    owner: input.owner,
    network: NETWORK,
    locale: input.locale,
    context: input.context,
    turns: [],
    turnCount: 0,
    steps: { agent_opened: 1 },
    createdAt: at,
    updatedAt: at,
  };
  const inserted = await versioned(store).compareAndSet(sessionKey(input.owner, record.id), null, AgentSessionRecordSchema.parse(record));
  if (!inserted) return { ok: false, code: "UNAVAILABLE" };
  return { ok: true, record, opened: true };
}

/**
 * Append the two turns of one exchange and the steps it recorded. Written
 * against the revision the caller read; a lost race is `false` and the
 * caller re-reads — the turns are never merged blindly.
 */
export async function appendTurns(
  store: GuardStore,
  read: AgentSessionRecord,
  input: Readonly<{ turns: readonly AgentTurn[]; steps: readonly string[]; nowMs: number }>,
): Promise<AgentSessionRecord | null> {
  const turns = [...read.turns, ...input.turns].slice(-AGENT_TURNS_KEPT);
  const steps = { ...read.steps };
  for (const step of input.steps) steps[step] = (steps[step] ?? 0) + 1;
  const next: AgentSessionRecord = { ...read, version: read.version + 1, turns, turnCount: read.turnCount + input.turns.length, steps, updatedAt: new Date(input.nowMs).toISOString() };
  const written = await versioned(store).compareAndSet(sessionKey(read.owner, read.id), read.version, AgentSessionRecordSchema.parse(next));
  return written ? next : null;
}
