/**
 * The drafts a turn prepared (`RYN-AGENT-TEXT-001`).
 *
 * A draft is a card in the contract's own shape — a plan's rules, a
 * condition, a trade intention — kept for a bounded time under the wallet
 * that asked for it, so the builder and the ticket open on exactly what the
 * person saw in the conversation. It is not a plan, not a monitor and not
 * an order: nothing reads a draft as a decision, and a draft the person never
 * opened expires unread. Keyed `solana:mainnet:<wallet>:<draftId>`, read back
 * only through the wallet's proof.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { AGENT_DRAFT_ID, AGENT_SESSION_ID, AGENT_TURN_ID, AgentMonitoringDraftCardSchema, AgentPlanDraftCardSchema, AgentTradeDraftCardSchema, BASE58, type AgentDraftCard } from "../api/v1/contract.ts";
import type { GuardStore } from "../guard/store.ts";

const COLLECTION = "agentDrafts" as const;

/** How long a draft is read back: a week, then it is gone; the builder keeps what it opened. */
export const DRAFT_TTL_MS = 7 * 86_400_000;

export const AgentDraftRecordSchema = z
  .object({
    schema: z.literal("ryntra.agent-draft"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    id: z.string().regex(AGENT_DRAFT_ID),
    owner: z.string().regex(BASE58),
    sessionId: z.string().regex(AGENT_SESSION_ID),
    turnId: z.string().regex(AGENT_TURN_ID),
    draft: z.discriminatedUnion("kind", [AgentPlanDraftCardSchema, AgentMonitoringDraftCardSchema, AgentTradeDraftCardSchema]),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AgentDraftRecord = z.output<typeof AgentDraftRecordSchema>;

export function newDraftId(): string {
  return `agd_${randomBytes(12).toString("hex")}`;
}

export function draftKey(owner: string, draftId: string): string {
  return `solana:mainnet:${owner}:${draftId}`;
}

function versioned(store: GuardStore) {
  return store.versioned<AgentDraftRecord>(COLLECTION);
}

export async function storeDraft(
  store: GuardStore,
  input: Readonly<{ owner: string; sessionId: string; turnId: string; draft: AgentDraftCard; nowMs: number }>,
): Promise<AgentDraftRecord | null> {
  const record: AgentDraftRecord = {
    schema: "ryntra.agent-draft",
    schemaVersion: "1.0.0",
    version: 1,
    id: input.draft.draftId,
    owner: input.owner,
    sessionId: input.sessionId,
    turnId: input.turnId,
    draft: input.draft,
    createdAt: new Date(input.nowMs).toISOString(),
    expiresAt: new Date(input.nowMs + DRAFT_TTL_MS).toISOString(),
  };
  const written = await versioned(store).compareAndSet(draftKey(input.owner, record.id), null, AgentDraftRecordSchema.parse(record));
  return written ? record : null;
}

/** The wallet's draft by id, while it lives; another wallet's id is simply not found. */
export async function readDraft(store: GuardStore, owner: string, draftId: string, nowMs: number): Promise<AgentDraftRecord | null> {
  if (!BASE58.test(owner) || !AGENT_DRAFT_ID.test(draftId)) return null;
  const raw = await versioned(store).get(draftKey(owner, draftId));
  if (raw === undefined || raw === null) return null;
  const parsed = AgentDraftRecordSchema.safeParse(raw);
  if (!parsed.success || parsed.data.owner !== owner) return null;
  return Date.parse(parsed.data.expiresAt) > nowMs ? parsed.data : null;
}
