/**
 * The one-shot ledger of the controlled cross-swap operation.
 *
 * Exactly one row, ever. It answers the single question no order record can:
 * **has this lane already had its one submit attempt?**
 *
 * An order record cannot answer it because it is keyed by intent, and a
 * rebuilt plan is a new intent by construction — the intent digest includes
 * `builtAt`. That is right for ordinary work, where somebody may swap twice.
 * It is exactly wrong for a controlled operation, which must be rebuildable
 * before signing and unrepeatable after. So the count lives here, above every
 * intent, and the states say what may still happen:
 *
 * - `NONE` — nothing built yet. A plan may be built.
 * - `PLANNED` — a plan exists and has not been submitted. **A stale plan may
 *   be rebuilt as often as needed**: rebuilding is not an attempt, moves
 *   nothing and consumes nothing.
 * - `SUBMIT_ATTEMPTED` — a submit was attempted. From this instant the route
 *   behaves as `PAUSED` for everything: no second submit, and no new plan
 *   either. Value may already have moved, and the answer to "may already have
 *   moved" is never another transaction.
 * - `RESOLVED` — the attempt reached an end state and was recorded. The route
 *   stays closed. **Nothing here ever sets `OPEN`**; that is a person's
 *   decision, taken afterwards, with the report in front of them.
 *
 * The transition into `SUBMIT_ATTEMPTED` is a compare-and-set on the row's
 * version. Two concurrent submits cannot both win it — the loser is refused
 * before it touches a wallet, which is the whole reason this is a stored row
 * and not a variable in a process.
 */

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

export const CROSS_SWAP_CANARY_STATES = ["NONE", "PLANNED", "SUBMIT_ATTEMPTED", "RESOLVED"] as const;
export type CrossSwapCanaryState = (typeof CROSS_SWAP_CANARY_STATES)[number];

/** How a controlled operation ended. Each one returns the route to closed. */
export const CROSS_SWAP_CANARY_RESOLUTIONS = ["SUCCESS", "FAILED", "REFUNDED", "RECOVERED"] as const;
export type CrossSwapCanaryResolution = (typeof CROSS_SWAP_CANARY_RESOLUTIONS)[number];

const HEX_DIGEST = /^0x[0-9a-f]{64}$/;

export const CrossSwapCanaryRecordSchema = z
  .object({
    version: z.number().int().min(0),
    state: z.enum(CROSS_SWAP_CANARY_STATES),
    /** The intent currently planned, or the one that was attempted. */
    intentDigest: z.string().regex(HEX_DIGEST).nullable(),
    /** How many times a plan was built. Rebuilds are expected and counted, not limited. */
    planCount: z.number().int().min(0).max(1000),
    /** How many submits were attempted. Never more than one. */
    submitCount: z.number().int().min(0).max(1),
    resolution: z.enum(CROSS_SWAP_CANARY_RESOLUTIONS).nullable(),
    firstPlannedAt: z.string().datetime({ offset: true }).nullable(),
    submitAttemptedAt: z.string().datetime({ offset: true }).nullable(),
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type CrossSwapCanaryRecord = z.output<typeof CrossSwapCanaryRecordSchema>;

const COLLECTION = "solanaCrossSwapCanary" as const;
/** One row, one key. The controlled operation is a singleton by definition. */
const KEY = "mainnet:cross-swap-canary";

export const EMPTY_CANARY: CrossSwapCanaryRecord = {
  version: 0,
  state: "NONE",
  intentDigest: null,
  planCount: 0,
  submitCount: 0,
  resolution: null,
  firstPlannedAt: null,
  submitAttemptedAt: null,
  resolvedAt: null,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export type CanaryReadResult =
  | Readonly<{ ok: true; record: CrossSwapCanaryRecord }>
  /* An unreadable ledger is not an empty one. Treating a malformed row as
     "nothing has happened" would let a second submit through on the one path
     where that matters most. */
  | Readonly<{ ok: false; code: "CANARY_LEDGER_UNREADABLE"; reason: string }>;

export async function readCrossSwapCanary(store: GuardStore): Promise<CanaryReadResult> {
  let raw: unknown;
  try {
    raw = await store.versioned<CrossSwapCanaryRecord>(COLLECTION).get(KEY);
  } catch (error) {
    return { ok: false, code: "CANARY_LEDGER_UNREADABLE", reason: error instanceof Error ? error.message : String(error) };
  }
  if (raw === null || raw === undefined) return { ok: true, record: EMPTY_CANARY };
  const parsed = CrossSwapCanaryRecordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "CANARY_LEDGER_UNREADABLE", reason: "The controlled-operation ledger is not a well-formed record." };
  return { ok: true, record: parsed.data };
}

export type CanaryClaimResult =
  | Readonly<{ ok: true; record: CrossSwapCanaryRecord }>
  | Readonly<{ ok: false; code: "CANARY_CLOSED" | "CANARY_ALREADY_ATTEMPTED" | "CANARY_NOT_PLANNED" | "CANARY_INTENT_MISMATCH" | "CANARY_LEDGER_UNREADABLE"; reason: string; record?: CrossSwapCanaryRecord }>;

/**
 * `expectedVersion` is `null` only for the very first write, which is a create
 * and must fail if a row already exists. Every later write states the version
 * it read, so a concurrent writer loses rather than clobbers.
 */
async function write(store: GuardStore, expectedVersion: number | null, next: CrossSwapCanaryRecord): Promise<boolean> {
  const parsed = CrossSwapCanaryRecordSchema.safeParse(next);
  if (!parsed.success) return false;
  return store.versioned<CrossSwapCanaryRecord>(COLLECTION).compareAndSet(KEY, expectedVersion, parsed.data);
}

/**
 * Record that a plan was built for the controlled operation.
 *
 * Allowed from `NONE` and from `PLANNED` — the second is the rebuild case the
 * owner asked for, when a quote goes stale before a signature. Refused once a
 * submit has been attempted, because a plan built then could only ever become
 * a second transaction.
 */
export async function claimCrossSwapCanaryPlan(
  store: GuardStore,
  intentDigest: string,
  at: string,
): Promise<CanaryClaimResult> {
  return withBoundedCasRetry(async () => {
    const read = await readCrossSwapCanary(store);
    if (!read.ok) return { ok: false, code: "CANARY_LEDGER_UNREADABLE", reason: "The controlled-operation ledger could not be read, so nothing may be built." } as const;
    const current = read.record;
    if (current.state === "SUBMIT_ATTEMPTED") {
      return { ok: false, code: "CANARY_ALREADY_ATTEMPTED", reason: "The controlled operation has already been submitted once. Resolve it by reading; nothing further is built here.", record: current } as const;
    }
    if (current.state === "RESOLVED") {
      return { ok: false, code: "CANARY_CLOSED", reason: "The controlled operation is finished. The route is closed until somebody opens it deliberately.", record: current } as const;
    }
    const next: CrossSwapCanaryRecord = {
      ...current,
      version: current.version + 1,
      state: "PLANNED",
      intentDigest,
      planCount: Math.min(current.planCount + 1, 1000),
      firstPlannedAt: current.firstPlannedAt ?? at,
      updatedAt: at,
    };
    /* A create only when nothing is stored yet; otherwise the version read. */
    const won = await write(store, current.version === 0 && current.state === "NONE" ? null : current.version, next);
    return won ? ({ ok: true, record: next } as const) : false;
  });
}

/**
 * Claim the single submit attempt.
 *
 * The one transition that must be atomic. Two concurrent submits race here and
 * exactly one wins; the loser is refused before it reaches a wallet. Only the
 * intent that was planned may be attempted, so a plan built for one set of
 * facts cannot be submitted against another.
 */
export async function claimCrossSwapCanarySubmit(
  store: GuardStore,
  intentDigest: string,
  at: string,
): Promise<CanaryClaimResult> {
  return withBoundedCasRetry(async () => {
    const read = await readCrossSwapCanary(store);
    if (!read.ok) return { ok: false, code: "CANARY_LEDGER_UNREADABLE", reason: "The controlled-operation ledger could not be read, so nothing may be submitted." } as const;
    const current = read.record;
    if (current.state === "SUBMIT_ATTEMPTED") {
      return { ok: false, code: "CANARY_ALREADY_ATTEMPTED", reason: "The controlled operation has already been submitted once. A second submit is never the answer.", record: current } as const;
    }
    if (current.state === "RESOLVED") {
      return { ok: false, code: "CANARY_CLOSED", reason: "The controlled operation is finished.", record: current } as const;
    }
    if (current.state !== "PLANNED") {
      return { ok: false, code: "CANARY_NOT_PLANNED", reason: "Nothing has been planned for the controlled operation.", record: current } as const;
    }
    if (current.intentDigest !== intentDigest) {
      return { ok: false, code: "CANARY_INTENT_MISMATCH", reason: "That is not the plan the controlled operation is holding.", record: current } as const;
    }
    const next: CrossSwapCanaryRecord = {
      ...current,
      version: current.version + 1,
      state: "SUBMIT_ATTEMPTED",
      submitCount: 1,
      submitAttemptedAt: at,
      updatedAt: at,
    };
    const won = await write(store, current.version, next);
    return won ? ({ ok: true, record: next } as const) : false;
  });
}

/**
 * Record how the controlled operation ended.
 *
 * Every resolution closes the route. None of them opens it: `OPEN` is a
 * decision a person takes afterwards, with the report in front of them, by
 * changing the variable themselves.
 */
export async function resolveCrossSwapCanary(
  store: GuardStore,
  resolution: CrossSwapCanaryResolution,
  at: string,
): Promise<CanaryClaimResult> {
  return withBoundedCasRetry(async () => {
    const read = await readCrossSwapCanary(store);
    if (!read.ok) return { ok: false, code: "CANARY_LEDGER_UNREADABLE", reason: "The controlled-operation ledger could not be read." } as const;
    const current = read.record;
    if (current.state === "RESOLVED") return { ok: true, record: current } as const;
    if (current.state !== "SUBMIT_ATTEMPTED") {
      return { ok: false, code: "CANARY_NOT_PLANNED", reason: "Nothing was attempted, so nothing can be resolved.", record: current } as const;
    }
    const next: CrossSwapCanaryRecord = { ...current, version: current.version + 1, state: "RESOLVED", resolution, resolvedAt: at, updatedAt: at };
    const won = await write(store, current.version, next);
    return won ? ({ ok: true, record: next } as const) : false;
  });
}
