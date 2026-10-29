/**
 * The durable conversation.
 *
 * One record per session in the Guard store, keyed by the proven wallet and
 * read back only through that proof — the same tenancy every other cabinet
 * collection keeps: `solana:mainnet:<wallet>:<sessionId>`, the trailing
 * colon on the scan prefix so one wallet's scan never reads a wallet whose
 * address starts the same way. The turns are structured — the person's
 * words, Ryn's answer with its cards and citations — and they are a record
 * of what was said, never the source of a balance, a plan's state, an
 * order's state or the inbox: those are read again through the tools on
 * every question. Compare-and-set on the store's revision keeps two answers
 * to one session from overwriting each other; the loser re-reads.
 *
 * AI-02: a conversation lives `AGENT_SESSION_RETENTION_DAYS` (90) days from
 * its last turn. Past that it is not read back, not listed and not resumed,
 * and the wallet's own read removes it — the retention the line's plan
 * states, not a clean-up job over other wallets. «Нова розмова» opens a
 * fresh session even where one for the same context exists, and the list
 * says each conversation's first question, its dates and when it expires.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  AGENT_SESSION_ID,
  AGENT_SESSION_RETENTION_DAYS,
  AGENT_TURNS_KEPT,
  AgentContextSchema,
  AgentTurnSchema,
  BASE58,
  NETWORK,
  type AgentContext,
  type AgentSession,
  type AgentSessionSummary,
  type AgentTurn,
} from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";

const COLLECTION = "agentSessions" as const;

/** How many sessions a wallet keeps; the oldest beyond it are not read back. */
export const SESSIONS_KEPT = 20;

const DAY_MS = 86_400_000;

/** When a session stops being read back: its last turn plus the retention. */
export function sessionExpiresAt(record: Pick<AgentSessionRecord, "updatedAt">): string {
  return new Date(Date.parse(record.updatedAt) + AGENT_SESSION_RETENTION_DAYS * DAY_MS).toISOString();
}

export function sessionExpired(record: Pick<AgentSessionRecord, "updatedAt">, nowMs: number): boolean {
  return Date.parse(sessionExpiresAt(record)) <= nowMs;
}

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

/** Remove one of the wallet's own sessions that outlived its retention; a failed removal leaves it unread, never shown. */
async function forget(store: GuardStore, record: AgentSessionRecord): Promise<void> {
  await versioned(store)
    .delete(sessionKey(record.owner, record.id))
    .catch(() => undefined);
}

export async function readSession(store: GuardStore, owner: string, sessionId: string, nowMs: number = Date.now()): Promise<AgentSessionRecord | null> {
  if (!BASE58.test(owner) || !AGENT_SESSION_ID.test(sessionId)) return null;
  const raw = await versioned(store).get(sessionKey(owner, sessionId));
  if (raw === undefined || raw === null) return null;
  const parsed = AgentSessionRecordSchema.safeParse(raw);
  /* A record of another wallet under this key cannot exist by construction; the check is the boundary said twice. */
  if (!parsed.success || parsed.data.owner !== owner) return null;
  if (sessionExpired(parsed.data, nowMs)) {
    await forget(store, parsed.data);
    return null;
  }
  return parsed.data;
}

/** The wallet's sessions within their retention, most recently updated first; the expired ones are removed on the way. */
export async function listSessions(store: GuardStore, owner: string, nowMs: number = Date.now()): Promise<readonly AgentSessionRecord[]> {
  if (!BASE58.test(owner)) return [];
  const values = await versioned(store).valuesWithPrefix(sessionPrefix(owner));
  const records = values
    .map((value) => AgentSessionRecordSchema.safeParse(value))
    .filter((parsed): parsed is { success: true; data: AgentSessionRecord } => parsed.success && parsed.data.owner === owner)
    .map((parsed) => parsed.data);
  for (const record of records) if (sessionExpired(record, nowMs)) await forget(store, record);
  return records
    .filter((record) => !sessionExpired(record, nowMs))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, SESSIONS_KEPT);
}

/** A conversation as the list shows it: its first question, how many turns, its dates and when it expires — never its answers. */
export function summariseSession(record: AgentSessionRecord): AgentSessionSummary {
  const first = record.turns.find((turn) => turn.role === "person")?.text ?? null;
  return {
    id: record.id,
    locale: record.locale,
    context: record.context,
    title: first ? first.replace(/\s+/g, " ").trim().slice(0, 120) : null,
    turnCount: record.turnCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: sessionExpiresAt(record),
  };
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
  input: Readonly<{ owner: string; locale: "en" | "uk"; context: AgentContext | null; sessionId?: string; fresh?: boolean; nowMs: number; newId?: () => string }>,
): Promise<Readonly<{ ok: true; record: AgentSessionRecord; opened: boolean }> | Readonly<{ ok: false; code: "AGENT_SESSION_NOT_FOUND" | "UNAVAILABLE" }>> {
  if (input.sessionId) {
    const found = await readSession(store, input.owner, input.sessionId, input.nowMs);
    if (!found) return { ok: false, code: "AGENT_SESSION_NOT_FOUND" };
    return { ok: true, record: found, opened: false };
  }
  /* «Нова розмова»: a fresh session whatever exists for the same context — but an empty one already open is that fresh session, so pressing it twice leaves no empty conversations behind. */
  const sameKind = (await listSessions(store, input.owner, input.nowMs)).filter((record) => sameContext(record.context, input.context) && record.locale === input.locale);
  const existing = input.fresh ? sameKind.find((record) => record.turns.length === 0) : sameKind[0];
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
