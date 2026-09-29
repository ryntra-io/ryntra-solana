import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../guard/canonical-json.ts";
import {
  GuardCasExhaustedError,
  type GuardStore,
  withBoundedCasRetry,
} from "../guard/store.ts";
import {
  evaluateSolanaCanaryIntent,
  SOLANA_CANARY_FAMILIES,
  SolanaCanaryBudgetSnapshotSchema,
  SolanaCanaryIntentSchema,
  solanaCanaryPolicyDigest,
  SolanaCanaryPolicySchema,
  type SolanaCanaryBudgetSnapshot,
  type SolanaCanaryFamily,
  type SolanaCanaryIntent,
  type SolanaCanaryPolicy,
  type SolanaCanaryVerdict,
} from "./canary-policy.ts";

const RAW_USD_MICROS = /^(0|[1-9][0-9]*)$/;
const RawUsdMicros = z.string().regex(RAW_USD_MICROS);

const FamilyLedgerSchema = z
  .object({
    reservedUsdMicros: RawUsdMicros,
    spentUsdMicros: RawUsdMicros,
  })
  .strict();

const FamiliesLedgerSchema = z
  .object({
    SEND: FamilyLedgerSchema,
    ATA_CREATE: FamilyLedgerSchema,
    SWAP: FamilyLedgerSchema,
    CCTP: FamilyLedgerSchema,
    TOKEN_2022: FamilyLedgerSchema,
  })
  .strict();

export const SolanaCanaryLedgerRecordSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-budget-ledger"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    policyId: z.string().min(1).max(96),
    totalLimitUsdMicros: RawUsdMicros,
    reservedUsdMicros: RawUsdMicros,
    spentUsdMicros: RawUsdMicros,
    feeReservedUsdMicros: RawUsdMicros,
    feeSpentUsdMicros: RawUsdMicros,
    families: FamiliesLedgerSchema,
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const familyReserved = SOLANA_CANARY_FAMILIES.reduce(
      (sum, family) => sum + BigInt(value.families[family].reservedUsdMicros),
      0n,
    );
    const familySpent = SOLANA_CANARY_FAMILIES.reduce(
      (sum, family) => sum + BigInt(value.families[family].spentUsdMicros),
      0n,
    );
    if (familyReserved + BigInt(value.feeReservedUsdMicros) !== BigInt(value.reservedUsdMicros)) {
      context.addIssue({ code: "custom", path: ["reservedUsdMicros"], message: "Principal plus fee reservations do not sum to the package reservation." });
    }
    if (familySpent + BigInt(value.feeSpentUsdMicros) !== BigInt(value.spentUsdMicros)) {
      context.addIssue({ code: "custom", path: ["spentUsdMicros"], message: "Principal plus fee spends do not sum to the package spend." });
    }
  });

export type SolanaCanaryLedgerRecord = z.output<typeof SolanaCanaryLedgerRecordSchema>;

export const SOLANA_CANARY_INTENT_STATES = [
  "RESERVED",
  "SUBMITTED_UNKNOWN",
  "COMMITTED",
  "RELEASED",
] as const;

export const SolanaCanaryIntentRecordSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-intent-record"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    idempotencyKey: z.string().regex(/^sci_[0-9a-f]{64}$/),
    policyId: z.string().min(1).max(96),
    policyDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    intentId: z.string().min(1).max(128),
    revision: z.number().int().min(1),
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    family: z.enum(SOLANA_CANARY_FAMILIES),
    principalUsdMicros: RawUsdMicros,
    feeReserveUsdMicros: RawUsdMicros,
    usdMicros: RawUsdMicros,
    state: z.enum(SOLANA_CANARY_INTENT_STATES),
    signature: z.string().min(64).max(96).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (BigInt(value.principalUsdMicros) + BigInt(value.feeReserveUsdMicros) !== BigInt(value.usdMicros)) {
      context.addIssue({
        code: "custom",
        path: ["usdMicros"],
        message: "Recorded total exposure must equal principal plus fee reserve.",
      });
    }
  });

export type SolanaCanaryIntentRecord = z.output<typeof SolanaCanaryIntentRecordSchema>;

type ReserveSuccess = Readonly<{
  ok: true;
  record: SolanaCanaryIntentRecord;
  snapshot: SolanaCanaryBudgetSnapshot;
  verdict: SolanaCanaryVerdict;
}>;

type ReserveFailure =
  | Readonly<{ ok: false; code: "DUPLICATE_INTENT"; reason: string; record: SolanaCanaryIntentRecord }>
  | Readonly<{ ok: false; code: "POLICY_REFUSED"; reason: string; verdict: SolanaCanaryVerdict }>
  | Readonly<{ ok: false; code: "STORE_CONTENDED"; reason: string }>;

type TransitionSuccess = Readonly<{ ok: true; record: SolanaCanaryIntentRecord }>;
type TransitionFailure = Readonly<{
  ok: false;
  code: "NOT_FOUND" | "STATE_REFUSED" | "CORRUPT_STATE" | "STORE_CONTENDED";
  reason: string;
}>;

function zeroFamilies(): SolanaCanaryLedgerRecord["families"] {
  return {
    SEND: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    ATA_CREATE: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    SWAP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    CCTP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    TOKEN_2022: { reservedUsdMicros: "0", spentUsdMicros: "0" },
  };
}

function newLedger(policy: SolanaCanaryPolicy, at: string): SolanaCanaryLedgerRecord {
  return {
    schema: "ryntra.solana.canary-budget-ledger",
    schemaVersion: "1.0.0",
    version: 1,
    policyId: policy.policyId,
    totalLimitUsdMicros: policy.totalLimitUsdMicros,
    reservedUsdMicros: "0",
    spentUsdMicros: "0",
    feeReservedUsdMicros: "0",
    feeSpentUsdMicros: "0",
    families: zeroFamilies(),
    updatedAt: at,
  };
}

function toSnapshot(
  store: GuardStore,
  policy: SolanaCanaryPolicy,
  record: SolanaCanaryLedgerRecord | null,
  observedAt: string,
): SolanaCanaryBudgetSnapshot {
  const current = record ?? newLedger(policy, observedAt);
  return SolanaCanaryBudgetSnapshotSchema.parse({
    schema: "ryntra.solana.canary-budget-snapshot",
    schemaVersion: "1.0.0",
    policyId: current.policyId,
    readState: "AVAILABLE",
    storeBoundary: store.durability,
    totalLimitUsdMicros: current.totalLimitUsdMicros,
    reservedUsdMicros: current.reservedUsdMicros,
    spentUsdMicros: current.spentUsdMicros,
    feeReservedUsdMicros: current.feeReservedUsdMicros,
    feeSpentUsdMicros: current.feeSpentUsdMicros,
    families: current.families,
    observedAt,
  });
}

function unavailableSnapshot(policy: SolanaCanaryPolicy, observedAt: string): SolanaCanaryBudgetSnapshot {
  return SolanaCanaryBudgetSnapshotSchema.parse({
    schema: "ryntra.solana.canary-budget-snapshot",
    schemaVersion: "1.0.0",
    policyId: policy.policyId,
    readState: "UNAVAILABLE",
    storeBoundary: "UNAVAILABLE",
    totalLimitUsdMicros: policy.totalLimitUsdMicros,
    reservedUsdMicros: "0",
    spentUsdMicros: "0",
    feeReservedUsdMicros: "0",
    feeSpentUsdMicros: "0",
    families: zeroFamilies(),
    observedAt,
  });
}

async function readLedgerRecord(
  store: GuardStore,
  policyId: string,
): Promise<{ state: "ABSENT"; record: null } | { state: "PRESENT"; record: SolanaCanaryLedgerRecord } | { state: "CORRUPT"; record: null }> {
  const raw = await store.collection<unknown>("solanaCanaryLedger").get(policyId);
  if (raw === undefined) return { state: "ABSENT", record: null };
  const parsed = SolanaCanaryLedgerRecordSchema.safeParse(raw);
  return parsed.success
    ? { state: "PRESENT", record: parsed.data }
    : { state: "CORRUPT", record: null };
}

export async function readSolanaCanaryBudget(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  now?: Date;
}): Promise<SolanaCanaryBudgetSnapshot> {
  const policy = SolanaCanaryPolicySchema.parse(args.policy);
  const observedAt = (args.now ?? new Date()).toISOString();
  try {
    const result = await readLedgerRecord(args.store, policy.policyId);
    if (result.state === "CORRUPT") return unavailableSnapshot(policy, observedAt);
    return toSnapshot(args.store, policy, result.record, observedAt);
  } catch {
    return unavailableSnapshot(policy, observedAt);
  }
}

export function solanaCanaryIdempotencyKey(args: {
  policyId: string;
  intentId: string;
  revision: number;
}): string {
  const preimage = canonicalJson({
    policyId: args.policyId,
    intentId: args.intentId,
    revision: args.revision,
  });
  return `sci_${createHash("sha256").update(`ryntra.solana.canary-intent-key.v1\n${preimage}`, "utf8").digest("hex")}`;
}

export async function readSolanaCanaryIntent(args: {
  store: GuardStore;
  idempotencyKey: string;
}): Promise<SolanaCanaryIntentRecord | null> {
  const raw = await args.store.collection<unknown>("solanaCanaryIntents").get(args.idempotencyKey);
  if (raw === undefined) return null;
  const parsed = SolanaCanaryIntentRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type SolanaCanarySpendEntry = Readonly<{
  family: SolanaCanaryFamily;
  state: SolanaCanaryIntentRecord["state"];
  principalUsdMicros: string;
  usdMicros: string;
  intentId: string;
  intentDigest: string;
  signature: string | null;
  updatedAt: string;
}>;

/**
 * The intents behind the totals, so a spend can be checked rather than
 * trusted.
 *
 * A budget that only prints a number asks to be believed. Each entry here
 * carries the transaction signature the exposure was settled against, which is
 * a public fact on a public chain: anyone can read it back and decide whether
 * the ledger is telling the truth. Only the two states that hold value are
 * returned — committed spends and submitted-unknown holds — because a released
 * reservation moved nothing and belongs in neither total.
 *
 * Read-only, and an unreadable or malformed row is skipped rather than
 * guessed: this function must never be the reason a page fails to render.
 */
export async function readSolanaCanarySpendEvidence(args: {
  store: GuardStore;
  policyId: string;
}): Promise<readonly SolanaCanarySpendEntry[]> {
  let rows: readonly unknown[];
  try {
    rows = await args.store.collection<unknown>("solanaCanaryIntents").valuesWithPrefix("sci_");
  } catch {
    return [];
  }
  const entries: SolanaCanarySpendEntry[] = [];
  for (const raw of rows) {
    const parsed = SolanaCanaryIntentRecordSchema.safeParse(raw);
    if (!parsed.success) continue;
    const record = parsed.data;
    if (record.policyId !== args.policyId) continue;
    if (record.state !== "COMMITTED" && record.state !== "SUBMITTED_UNKNOWN") continue;
    entries.push({
      family: record.family,
      state: record.state,
      principalUsdMicros: record.principalUsdMicros,
      usdMicros: record.usdMicros,
      intentId: record.intentId,
      intentDigest: record.intentDigest,
      signature: record.signature,
      updatedAt: record.updatedAt,
    });
  }
  return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function add(value: string, delta: bigint): string {
  return (BigInt(value) + delta).toString();
}

function reserveLedger(
  current: SolanaCanaryLedgerRecord,
  family: SolanaCanaryFamily,
  principal: bigint,
  feeReserve: bigint,
  total: bigint,
  at: string,
): SolanaCanaryLedgerRecord {
  return SolanaCanaryLedgerRecordSchema.parse({
    ...current,
    version: current.version + 1,
    reservedUsdMicros: add(current.reservedUsdMicros, total),
    feeReservedUsdMicros: add(current.feeReservedUsdMicros, feeReserve),
    families: {
      ...current.families,
      [family]: {
        ...current.families[family],
        reservedUsdMicros: add(current.families[family].reservedUsdMicros, principal),
      },
    },
    updatedAt: at,
  });
}

function buildIntentRecord(args: {
  policy: SolanaCanaryPolicy;
  intent: SolanaCanaryIntent;
  verdict: SolanaCanaryVerdict;
  idempotencyKey: string;
  at: string;
}): SolanaCanaryIntentRecord {
  if (
    args.intent.principalUsdMicros === null ||
    args.intent.feeReserveUsdMicros === null ||
    args.intent.usdMicros === null
  ) {
    throw new Error("An allowed canary intent must have exact principal, fee-reserve and total USD-micro exposure.");
  }
  return SolanaCanaryIntentRecordSchema.parse({
    schema: "ryntra.solana.canary-intent-record",
    schemaVersion: "1.0.0",
    version: 1,
    idempotencyKey: args.idempotencyKey,
    policyId: args.policy.policyId,
    policyDigest: args.verdict.policyDigest,
    intentId: args.intent.intentId,
    revision: args.intent.revision,
    intentDigest: args.verdict.intentDigest,
    family: args.intent.family,
    principalUsdMicros: args.intent.principalUsdMicros,
    feeReserveUsdMicros: args.intent.feeReserveUsdMicros,
    usdMicros: args.intent.usdMicros,
    state: "RESERVED",
    signature: null,
    createdAt: args.at,
    updatedAt: args.at,
  });
}

export async function reserveSolanaCanaryIntent(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  intent: SolanaCanaryIntent;
  now?: Date;
}): Promise<ReserveSuccess | ReserveFailure> {
  const policy = SolanaCanaryPolicySchema.parse(args.policy);
  const intent = SolanaCanaryIntentSchema.parse(args.intent);
  const now = args.now ?? new Date();
  const at = now.toISOString();
  const idempotencyKey = solanaCanaryIdempotencyKey({
    policyId: policy.policyId,
    intentId: intent.intentId,
    revision: intent.revision,
  });

  try {
    return await withBoundedCasRetry(async () => {
      const existing = await readSolanaCanaryIntent({ store: args.store, idempotencyKey });
      if (existing) {
        return {
          ok: false,
          code: "DUPLICATE_INTENT",
          reason: "This exact canary intent revision already has a durable record and is never submitted again automatically.",
          record: existing,
        } as const;
      }

      const ledgerRead = await readLedgerRecord(args.store, policy.policyId);
      const snapshot =
        ledgerRead.state === "CORRUPT"
          ? unavailableSnapshot(policy, at)
          : toSnapshot(args.store, policy, ledgerRead.record, at);
      const verdict = evaluateSolanaCanaryIntent({ policy, budget: snapshot, intent, now });
      if (verdict.decision !== "ALLOW") {
        return {
          ok: false,
          code: "POLICY_REFUSED",
          reason: `The canary policy returned ${verdict.decision}; no budget was reserved.`,
          verdict,
        } as const;
      }

      const current = ledgerRead.record ?? newLedger(policy, at);
      const principal = BigInt(intent.principalUsdMicros as string);
      const feeReserve = BigInt(intent.feeReserveUsdMicros as string);
      const total = BigInt(intent.usdMicros as string);
      const nextLedger = reserveLedger(current, intent.family, principal, feeReserve, total, at);
      const record = buildIntentRecord({ policy, intent, verdict, idempotencyKey, at });
      const won = await args.store.compareAndSetMany([
        {
          collection: "solanaCanaryLedger",
          key: policy.policyId,
          expectedVersion: ledgerRead.record?.version ?? null,
          next: nextLedger,
        },
        {
          collection: "solanaCanaryIntents",
          key: idempotencyKey,
          expectedVersion: null,
          next: record,
        },
      ]);
      if (!won) return false;
      return {
        ok: true,
        record,
        snapshot: toSnapshot(args.store, policy, nextLedger, at),
        verdict,
      } as const;
    });
  } catch (failure) {
    if (!(failure instanceof GuardCasExhaustedError)) throw failure;
    return {
      ok: false,
      code: "STORE_CONTENDED",
      reason: "The durable canary ledger did not settle inside its bounded contention budget.",
    };
  }
}

async function updateIntentOnly(args: {
  store: GuardStore;
  idempotencyKey: string;
  allowedState: SolanaCanaryIntentRecord["state"];
  nextState: SolanaCanaryIntentRecord["state"];
  signature: string | null;
  at: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  try {
    return await withBoundedCasRetry(async () => {
      const raw = await args.store.collection<unknown>("solanaCanaryIntents").get(args.idempotencyKey);
      if (raw === undefined) return { ok: false, code: "NOT_FOUND", reason: "The canary intent record does not exist." } as const;
      const parsed = SolanaCanaryIntentRecordSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, code: "CORRUPT_STATE", reason: "The canary intent record is malformed." } as const;
      if (parsed.data.state !== args.allowedState) {
        return { ok: false, code: "STATE_REFUSED", reason: `A ${parsed.data.state} canary intent cannot move to ${args.nextState}.` } as const;
      }
      const record = SolanaCanaryIntentRecordSchema.parse({
        ...parsed.data,
        version: parsed.data.version + 1,
        state: args.nextState,
        signature: args.signature,
        updatedAt: args.at,
      });
      const won = await args.store.versioned<SolanaCanaryIntentRecord>("solanaCanaryIntents").compareAndSet(
        args.idempotencyKey,
        parsed.data.version,
        record,
      );
      return won ? ({ ok: true, record } as const) : false;
    });
  } catch (failure) {
    if (!(failure instanceof GuardCasExhaustedError)) throw failure;
    return { ok: false, code: "STORE_CONTENDED", reason: "The canary intent transition exceeded its contention budget." };
  }
}

export async function markSolanaCanarySubmitUnknown(args: {
  store: GuardStore;
  idempotencyKey: string;
  signature: string;
  at?: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  return updateIntentOnly({
    store: args.store,
    idempotencyKey: args.idempotencyKey,
    allowedState: "RESERVED",
    nextState: "SUBMITTED_UNKNOWN",
    signature: args.signature,
    at: args.at ?? new Date().toISOString(),
  });
}

function moveLedgerExposure(args: {
  current: SolanaCanaryLedgerRecord;
  record: SolanaCanaryIntentRecord;
  commit: boolean;
  at: string;
}): SolanaCanaryLedgerRecord | null {
  const packageValue = BigInt(args.record.usdMicros);
  const familyValue = BigInt(args.record.principalUsdMicros);
  const feeValue = BigInt(args.record.feeReserveUsdMicros);
  const family = args.record.family;
  const packageReserved = BigInt(args.current.reservedUsdMicros);
  const familyReserved = BigInt(args.current.families[family].reservedUsdMicros);
  const feeReserved = BigInt(args.current.feeReservedUsdMicros);
  if (packageReserved < packageValue || familyReserved < familyValue || feeReserved < feeValue) return null;
  return SolanaCanaryLedgerRecordSchema.parse({
    ...args.current,
    version: args.current.version + 1,
    reservedUsdMicros: (packageReserved - packageValue).toString(),
    spentUsdMicros: args.commit
      ? add(args.current.spentUsdMicros, packageValue)
      : args.current.spentUsdMicros,
    feeReservedUsdMicros: (feeReserved - feeValue).toString(),
    feeSpentUsdMicros: args.commit
      ? add(args.current.feeSpentUsdMicros, feeValue)
      : args.current.feeSpentUsdMicros,
    families: {
      ...args.current.families,
      [family]: {
        reservedUsdMicros: (familyReserved - familyValue).toString(),
        spentUsdMicros: args.commit
          ? add(args.current.families[family].spentUsdMicros, familyValue)
          : args.current.families[family].spentUsdMicros,
      },
    },
    updatedAt: args.at,
  });
}

async function settleReservation(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  idempotencyKey: string;
  signature: string | null;
  commit: boolean;
  allowSubmittedUnknownRelease?: boolean;
  requiredSignature?: string;
  at: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  const policy = SolanaCanaryPolicySchema.parse(args.policy);
  try {
    return await withBoundedCasRetry(async () => {
      const rawIntent = await args.store.collection<unknown>("solanaCanaryIntents").get(args.idempotencyKey);
      if (rawIntent === undefined) return { ok: false, code: "NOT_FOUND", reason: "The canary intent record does not exist." } as const;
      const parsedIntent = SolanaCanaryIntentRecordSchema.safeParse(rawIntent);
      if (!parsedIntent.success) return { ok: false, code: "CORRUPT_STATE", reason: "The canary intent record is malformed." } as const;
      const allowed = args.commit
        ? parsedIntent.data.state === "RESERVED" || parsedIntent.data.state === "SUBMITTED_UNKNOWN"
        : parsedIntent.data.state === "RESERVED" ||
          (args.allowSubmittedUnknownRelease === true &&
            parsedIntent.data.state === "SUBMITTED_UNKNOWN" &&
            parsedIntent.data.signature === args.requiredSignature);
      if (!allowed) {
        return {
          ok: false,
          code: "STATE_REFUSED",
          reason: args.commit
            ? `A ${parsedIntent.data.state} canary intent cannot be committed.`
            : `A ${parsedIntent.data.state} canary intent cannot release its reservation.`,
        } as const;
      }
      const ledgerRead = await readLedgerRecord(args.store, policy.policyId);
      if (ledgerRead.state !== "PRESENT") {
        return { ok: false, code: "CORRUPT_STATE", reason: "The canary budget ledger is missing or malformed." } as const;
      }
      const nextLedger = moveLedgerExposure({
        current: ledgerRead.record,
        record: parsedIntent.data,
        commit: args.commit,
        at: args.at,
      });
      if (!nextLedger) return { ok: false, code: "CORRUPT_STATE", reason: "The canary reservation exceeds the recorded exposure." } as const;
      const record = SolanaCanaryIntentRecordSchema.parse({
        ...parsedIntent.data,
        version: parsedIntent.data.version + 1,
        state: args.commit ? "COMMITTED" : "RELEASED",
        signature: args.signature ?? parsedIntent.data.signature,
        updatedAt: args.at,
      });
      const won = await args.store.compareAndSetMany([
        {
          collection: "solanaCanaryLedger",
          key: policy.policyId,
          expectedVersion: ledgerRead.record.version,
          next: nextLedger,
        },
        {
          collection: "solanaCanaryIntents",
          key: args.idempotencyKey,
          expectedVersion: parsedIntent.data.version,
          next: record,
        },
      ]);
      return won ? ({ ok: true, record } as const) : false;
    });
  } catch (failure) {
    if (!(failure instanceof GuardCasExhaustedError)) throw failure;
    return { ok: false, code: "STORE_CONTENDED", reason: "The canary ledger transition exceeded its contention budget." };
  }
}

export type ObservedSpendResult =
  | Readonly<{ ok: true; record: SolanaCanaryIntentRecord; snapshot: SolanaCanaryBudgetSnapshot }>
  | Readonly<{ ok: false; code: "ALREADY_RECORDED"; reason: string; record: SolanaCanaryIntentRecord }>
  | Readonly<{ ok: false; code: "STORE_CONTENDED" | "CORRUPT_STATE"; reason: string }>;

/**
 * Write a spend that already happened, on evidence rather than on permission.
 *
 * This is the one path into the ledger that does not consult the policy, and
 * the reason is that it is not asking for anything. `reserveSolanaCanaryIntent`
 * decides whether new risk may be taken; a canary that has already burned on
 * mainnet is not new risk, it is history, and history does not become untrue
 * because the operator has since thrown the emergency stop or the valuation
 * window has closed. Refusing to record it would leave the budget reporting
 * less spent than was spent, which is the direction that permits an overspend.
 *
 * What keeps it narrow:
 *
 * - it is reachable from a script under an explicit argument, never from a
 *   route, so nothing a browser can send arrives here;
 * - it writes a `COMMITTED` record and moves `spent` only — it can never
 *   create a reservation, authorize anything, or raise a ceiling;
 * - it is keyed by the same idempotency key the live path uses, so recording
 *   the same transfer twice is refused by the store rather than by a caller
 *   remembering, and a live intent already at that key is never overwritten;
 * - it requires the signature that proves the claim, and that signature is
 *   what the workspace prints beside the figure.
 */
export async function recordSolanaCanaryObservedSpend(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  family: SolanaCanaryFamily;
  intentId: string;
  revision: number;
  intentDigest: string;
  principalUsdMicros: string;
  feeSpentUsdMicros?: string;
  signature: string;
  at?: string;
}): Promise<ObservedSpendResult> {
  const policy = SolanaCanaryPolicySchema.parse(args.policy);
  const at = args.at ?? new Date().toISOString();
  const principal = BigInt(args.principalUsdMicros);
  const fee = BigInt(args.feeSpentUsdMicros ?? "0");
  const idempotencyKey = solanaCanaryIdempotencyKey({
    policyId: policy.policyId,
    intentId: args.intentId,
    revision: args.revision,
  });

  try {
    return await withBoundedCasRetry(async () => {
      const existing = await readSolanaCanaryIntent({ store: args.store, idempotencyKey });
      if (existing) {
        return {
          ok: false,
          code: "ALREADY_RECORDED",
          reason: `This canary spend is already recorded as ${existing.state}; reading the same evidence again never debits the budget twice.`,
          record: existing,
        } as const;
      }

      const ledgerRead = await readLedgerRecord(args.store, policy.policyId);
      if (ledgerRead.state === "CORRUPT") {
        return { ok: false, code: "CORRUPT_STATE", reason: "The durable canary budget ledger is malformed." } as const;
      }
      const current = ledgerRead.record ?? newLedger(policy, at);
      const nextLedger = SolanaCanaryLedgerRecordSchema.parse({
        ...current,
        version: current.version + 1,
        spentUsdMicros: add(current.spentUsdMicros, principal + fee),
        feeSpentUsdMicros: add(current.feeSpentUsdMicros, fee),
        families: {
          ...current.families,
          [args.family]: {
            ...current.families[args.family],
            spentUsdMicros: add(current.families[args.family].spentUsdMicros, principal),
          },
        },
        updatedAt: at,
      });
      const record = SolanaCanaryIntentRecordSchema.parse({
        schema: "ryntra.solana.canary-intent-record",
        schemaVersion: "1.0.0",
        version: 1,
        idempotencyKey,
        policyId: policy.policyId,
        policyDigest: solanaCanaryPolicyDigest(policy),
        intentId: args.intentId,
        revision: args.revision,
        intentDigest: args.intentDigest,
        family: args.family,
        principalUsdMicros: principal.toString(),
        feeReserveUsdMicros: fee.toString(),
        usdMicros: (principal + fee).toString(),
        state: "COMMITTED",
        signature: args.signature,
        createdAt: at,
        updatedAt: at,
      });
      const won = await args.store.compareAndSetMany([
        {
          collection: "solanaCanaryLedger",
          key: policy.policyId,
          expectedVersion: ledgerRead.record?.version ?? null,
          next: nextLedger,
        },
        {
          collection: "solanaCanaryIntents",
          key: idempotencyKey,
          expectedVersion: null,
          next: record,
        },
      ]);
      if (!won) return false;
      return { ok: true, record, snapshot: toSnapshot(args.store, policy, nextLedger, at) } as const;
    });
  } catch (failure) {
    if (!(failure instanceof GuardCasExhaustedError)) throw failure;
    return {
      ok: false,
      code: "STORE_CONTENDED",
      reason: "The durable canary ledger did not settle inside its bounded contention budget.",
    };
  }
}

export async function commitSolanaCanarySpend(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  idempotencyKey: string;
  signature: string;
  at?: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  return settleReservation({
    store: args.store,
    policy: args.policy,
    idempotencyKey: args.idempotencyKey,
    signature: args.signature,
    commit: true,
    at: args.at ?? new Date().toISOString(),
  });
}

export async function releaseSolanaCanaryReservation(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  idempotencyKey: string;
  at?: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  return settleReservation({
    store: args.store,
    policy: args.policy,
    idempotencyKey: args.idempotencyKey,
    signature: null,
    commit: false,
    at: args.at ?? new Date().toISOString(),
  });
}

/**
 * Release an unknown reservation after the caller independently proved the
 * exact signature landed and failed, so no value moved.
 *
 * This is the same transition as `expireSolanaCanaryBeforeSubmit` under a
 * different proof, and the pair is deliberate rather than duplicated. Crossing
 * `SUBMITTED_UNKNOWN` is only ever legal when the caller has established on
 * chain that nothing moved, and there are exactly two ways to establish it:
 * the signature was never seen and can no longer land, or it was seen, landed,
 * and reverted. Anything short of one of those two proofs — a timeout, an
 * unreadable status, silence — is not a proof, holds its exposure, and is
 * never released for an automatic retry.
 *
 * A reverted burn is the one determined failure the CCTP lane produces: the
 * transaction landed with an error, so no message exists and no USDC left the
 * wallet. Booking it as a spend would overstate the canary; stranding it as
 * exposure would understate the remaining budget for every later family.
 */
export async function releaseSolanaCanaryOnProvenFailure(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  idempotencyKey: string;
  signature: string;
  at?: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  return settleReservation({
    store: args.store,
    policy: args.policy,
    idempotencyKey: args.idempotencyKey,
    signature: null,
    commit: false,
    allowSubmittedUnknownRelease: true,
    requiredSignature: args.signature,
    at: args.at ?? new Date().toISOString(),
  });
}

/**
 * Release an unknown reservation only after the caller independently proved
 * the exact signed message's blockhash invalid and the signature unseen.
 * Ordinary release remains unable to cross SUBMITTED_UNKNOWN.
 */
export async function expireSolanaCanaryBeforeSubmit(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  idempotencyKey: string;
  signature: string;
  at?: string;
}): Promise<TransitionSuccess | TransitionFailure> {
  return settleReservation({
    store: args.store,
    policy: args.policy,
    idempotencyKey: args.idempotencyKey,
    signature: null,
    commit: false,
    allowSubmittedUnknownRelease: true,
    requiredSignature: args.signature,
    at: args.at ?? new Date().toISOString(),
  });
}
