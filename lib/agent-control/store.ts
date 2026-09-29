import { z } from "zod";

import { compareCanonicalStrings } from "../guard/canonical-json.ts";
import type { GuardStore } from "../guard/store.ts";
import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "./canonical.ts";

/**
 * Durable store v1 for the Agent Control lifecycle.
 *
 * It adds no adapter. `lib/guard/store.ts` already carries the three that
 * matter — memory, file and Postgres — behind one contract whose two
 * uncomposable primitives are exactly what this layer needs: `insertIfAbsent`,
 * which claims a key atomically, and `compareAndSet`, which writes only if the
 * stored version is still the one you read. Building a second store beside it
 * would mean two things that must agree about durability, and this repository
 * has recorded what happens to two things that must agree.
 *
 * Three properties are enforced here rather than left to callers:
 *
 * 1. **Idempotency is a claim, not a check.** A read-then-write is a race: two
 *    instances both see a free key and both write. Every lifecycle entry point
 *    claims its key through `insertIfAbsent` and returns the winner's record to
 *    the loser, so a replayed request yields the same record rather than a
 *    second one.
 *
 * 2. **The audit trail is append-only by construction.** Entries are written
 *    only through `insertIfAbsent` under a sequence key. There is no code path
 *    that overwrites one, so "append-only" is a property of the mechanism
 *    rather than a rule somebody has to remember.
 *
 * 3. **A terminal state is never reopened.** This is the payout kernel's rule
 *    arriving here for the same reason it was written there: a slow read that
 *    resolves after a lifecycle already failed must not rewrite it into
 *    something in flight.
 */

const timestamp = z.string().datetime({ offset: true });
const HEX_HASH = /^0x[0-9a-f]{64}$/;

/** Where a lifecycle can be, and which of those are final. */
export const AGENT_LIFECYCLE_STATES = [
  "DRAFTED",
  "PREFLIGHTED",
  "AUTHORIZED",
  "OBSERVED",
  "RECONCILED",
  "BLOCKED",
  "FAILED",
] as const;

export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number];

export const AGENT_TERMINAL_STATES = ["RECONCILED", "BLOCKED", "FAILED"] as const;

export function isTerminalState(state: AgentLifecycleState): boolean {
  return (AGENT_TERMINAL_STATES as readonly string[]).includes(state);
}

export const AgentLifecycleRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    lifecycleId: z.string().min(3).max(128),
    idempotencyKey: z.string().min(8).max(256),
    state: z.enum(AGENT_LIFECYCLE_STATES),
    intentHash: z.string().regex(HEX_HASH),
    contentHash: z.string().regex(HEX_HASH).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export type AgentLifecycleRecord = z.output<typeof AgentLifecycleRecordSchema>;

export const AgentPolicyRecordSchema = z
  .object({
    version: z.number().int().positive(),
    id: z.string().min(1).max(128),
    publishedAt: timestamp,
    digest: z.string().regex(HEX_HASH),
    definition: z.unknown(),
  })
  .strict();

export type AgentPolicyRecord = z.output<typeof AgentPolicyRecordSchema>;

export const AgentAuditEntrySchema = z
  .object({
    version: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    lifecycleId: z.string().min(3).max(128),
    event: z.string().min(1).max(128),
    from: z.enum(AGENT_LIFECYCLE_STATES).nullable(),
    to: z.enum(AGENT_LIFECYCLE_STATES),
    at: timestamp,
  })
  .strict();

export type AgentAuditEntry = z.output<typeof AgentAuditEntrySchema>;

const AgentIdempotencyRecordSchema = z
  .object({
    version: z.number().int().positive(),
    lifecycleId: z.string().min(3).max(128),
  })
  .strict();

type AgentIdempotencyRecord = z.output<typeof AgentIdempotencyRecordSchema>;

export const STORE_REFUSALS = [
  "TERMINAL_STATE_NOT_REOPENABLE",
  "LIFECYCLE_NOT_FOUND",
  "POLICY_VERSION_IMMUTABLE",
  "STATE_TRANSITION_LOST_RACE",
] as const;

export type StoreRefusal = (typeof STORE_REFUSALS)[number];

export class AgentStoreError extends Error {
  readonly reasonCode: StoreRefusal;

  constructor(reasonCode: StoreRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "AgentStoreError";
    this.reasonCode = reasonCode;
  }
}

/** Audit keys sort in write order, so a scan reads the trail as it happened. */
function auditKey(lifecycleId: string, sequence: number): string {
  return `${lifecycleId}#${String(sequence).padStart(6, "0")}`;
}

export function createAgentControlStore(store: GuardStore) {
  const lifecycles = store.versioned<AgentLifecycleRecord>("agentIntents");
  const policies = store.versioned<AgentPolicyRecord>("agentPolicies");
  const audit = store.collection<AgentAuditEntry>("agentAudit");
  const idempotency = store.collection<AgentIdempotencyRecord>("agentIdempotency");

  async function appendAudit(entry: Omit<AgentAuditEntry, "version" | "sequence">): Promise<number> {
    /* The sequence is claimed, not assigned. Two writers racing for the same
       slot both call `insertIfAbsent`; one wins and the other advances. There is
       no path that overwrites an entry, which is what makes the trail
       append-only by construction rather than by convention. */
    for (let sequence = 0; sequence < 10_000; sequence += 1) {
      const value = AgentAuditEntrySchema.parse({ ...entry, version: 0, sequence });
      if (await audit.insertIfAbsent(auditKey(entry.lifecycleId, sequence), value)) return sequence;
    }
    throw new AgentStoreError("STATE_TRANSITION_LOST_RACE", "the audit trail did not accept an entry");
  }

  return {
    /**
     * Claim a lifecycle for an idempotency key.
     *
     * The loser of the race gets the winner's record rather than an error,
     * because a replayed request is not a failure — it is the same request.
     */
    async openLifecycle(input: {
      lifecycleId: string;
      idempotencyKey: string;
      intentHash: string;
      initialState?: AgentLifecycleState;
      contentHash?: string | null;
      initialEvent?: string;
      now?: Date;
    }): Promise<{ record: AgentLifecycleRecord; created: boolean }> {
      const now = (input.now ?? new Date()).toISOString();
      const idempotencyRecord = AgentIdempotencyRecordSchema.parse({
        version: 1,
        lifecycleId: input.lifecycleId,
      });
      const record = AgentLifecycleRecordSchema.parse({
        version: 1,
        lifecycleId: input.lifecycleId,
        idempotencyKey: input.idempotencyKey,
        state: input.initialState ?? "DRAFTED",
        intentHash: input.intentHash,
        contentHash: input.contentHash ?? null,
        createdAt: now,
        updatedAt: now,
      });
      const opened = AgentAuditEntrySchema.parse({
        version: 0,
        sequence: 0,
        lifecycleId: input.lifecycleId,
        event: input.initialEvent ?? "OPENED",
        from: null,
        to: record.state,
        at: now,
      });

      /* The nonce/idempotency claim, lifecycle and first audit fact are one
         transaction. A process interruption may expose all three or none;
         there is no state where a consumed key points at a lifecycle that was
         never written. */
      const created = await store.compareAndSetMany([
        {
          collection: "agentIdempotency",
          key: input.idempotencyKey,
          expectedVersion: null,
          next: idempotencyRecord,
        },
        {
          collection: "agentIntents",
          key: input.lifecycleId,
          expectedVersion: null,
          next: record,
        },
        {
          collection: "agentAudit",
          key: auditKey(input.lifecycleId, 0),
          expectedVersion: null,
          next: opened,
        },
      ]);
      if (!created) {
        const existing = await idempotency.get(input.idempotencyKey);
        const existingRecord = existing ? await lifecycles.get(existing.lifecycleId) : undefined;
        if (!existingRecord) {
          throw new AgentStoreError(
            "STATE_TRANSITION_LOST_RACE",
            existing
              ? "an idempotency key points at no lifecycle"
              : "the lifecycle id or initial audit key is already occupied by another request",
          );
        }
        return { record: existingRecord, created: false };
      }
      return { record, created: true };
    },

    /**
     * Move a lifecycle forward.
     *
     * A terminal state is refused by name. The alternative — letting a late
     * observation rewrite a failed lifecycle into something in flight — is the
     * exact defect the payout kernel wrote this rule for.
     */
    async advance(input: {
      lifecycleId: string;
      to: AgentLifecycleState;
      contentHash?: string | null;
      now?: Date;
    }): Promise<AgentLifecycleRecord> {
      const current = await lifecycles.get(input.lifecycleId);
      if (!current) throw new AgentStoreError("LIFECYCLE_NOT_FOUND", input.lifecycleId);
      if (isTerminalState(current.state)) {
        throw new AgentStoreError(
          "TERMINAL_STATE_NOT_REOPENABLE",
          `${input.lifecycleId} is ${current.state} and cannot become ${input.to}`,
        );
      }

      const now = (input.now ?? new Date()).toISOString();
      const next = AgentLifecycleRecordSchema.parse({
        ...current,
        version: current.version + 1,
        state: input.to,
        contentHash: input.contentHash === undefined ? current.contentHash : input.contentHash,
        updatedAt: now,
      });
      if (!(await lifecycles.compareAndSet(input.lifecycleId, current.version, next))) {
        throw new AgentStoreError("STATE_TRANSITION_LOST_RACE", input.lifecycleId);
      }
      await appendAudit({
        lifecycleId: input.lifecycleId,
        event: "ADVANCED",
        from: current.state,
        to: input.to,
        at: now,
      });
      return next;
    },

    /**
     * Publish a policy version.
     *
     * An edit is a new version, never a rewrite: the key carries the version,
     * so `insertIfAbsent` refuses a second write to the same one. That is why
     * immutability needs no separate enforcement — there is no operation that
     * could break it.
     */
    async publishPolicy(input: {
      id: string;
      version: number;
      definition: unknown;
      now?: Date;
    }): Promise<AgentPolicyRecord> {
      const record = AgentPolicyRecordSchema.parse({
        version: input.version,
        id: input.id,
        publishedAt: (input.now ?? new Date()).toISOString(),
        digest: hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.policy, input.definition),
        definition: input.definition,
      });
      const key = `${input.id}@${input.version}`;
      if (!(await policies.compareAndSet(key, null, record))) {
        throw new AgentStoreError(
          "POLICY_VERSION_IMMUTABLE",
          `${key} is already published; an edit is a new version`,
        );
      }
      return record;
    },

    readPolicy(id: string, version: number): Promise<AgentPolicyRecord | undefined> {
      return policies.get(`${id}@${version}`);
    },

    readLifecycle(lifecycleId: string): Promise<AgentLifecycleRecord | undefined> {
      return lifecycles.get(lifecycleId);
    },

    /** The trail in the order it was written. */
    async readAudit(lifecycleId: string): Promise<readonly AgentAuditEntry[]> {
      const entries: AgentAuditEntry[] = [];
      for (let sequence = 0; sequence < 10_000; sequence += 1) {
        const entry = await audit.get(auditKey(lifecycleId, sequence));
        if (!entry) break;
        entries.push(entry);
      }
      return entries.sort((left, right) =>
        compareCanonicalStrings(auditKey(left.lifecycleId, left.sequence), auditKey(right.lifecycleId, right.sequence)),
      );
    },
  };
}

export type AgentControlStore = ReturnType<typeof createAgentControlStore>;
