import type { GuardAtomicVersionedWrite, GuardStore } from "../guard/store.ts";
import type { RyntraServiceFee } from "../swap/service-fee.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";

export type BenefitJobData = Readonly<{ wallet: string; operationId: string; settledAt: string }> & (
  | Readonly<{ kind: "REWARDS"; fee: RyntraServiceFee; providerUsd?: number | null; price?: Readonly<{ price: string; sourceRef: string; observedAt: string }> | null }>
  | Readonly<{ kind: "POINTS"; action: SolanaWalletAction; statedUsd?: Readonly<{ value: string; sourceRef: string }> | null }>
  | Readonly<{ kind: "CROSS_SWAP" }>
  /* «First $10 back»: the cluster check of a wallet that holds the window (rules 2.1.0), until it decides. */
  | Readonly<{ kind: "FIRST_TEN_CHECK" }>
  /* Ryntra Partners R3: the pair check of a friend's trade — `wallet` the trader, `operationId` the wallet paid for it. */
  | Readonly<{ kind: "REFERRAL_CHECK" }>
);
type BenefitJob = Readonly<{ version: number; data: BenefitJobData; createdAt: string; nextAttemptAt: string; attempts: number }>;
const keyOf = (data: BenefitJobData) => `${data.wallet}:${data.kind}:${data.operationId}`;

/** Only named financial facts are persisted; caller environments/dependencies
 * and any signing material are deliberately not part of this payload. */
function cleanJob(data: BenefitJobData): BenefitJobData {
  const base = { wallet: data.wallet, operationId: data.operationId, settledAt: data.settledAt };
  return data.kind === "REWARDS"
    ? { ...base, kind: data.kind, fee: data.fee, providerUsd: data.providerUsd ?? null, ...(data.price !== undefined ? { price: data.price } : {}) }
    : data.kind === "POINTS" ? { ...base, kind: data.kind, action: data.action, statedUsd: data.statedUsd ?? null }
    : { ...base, kind: data.kind };
}

export async function enqueueBenefitJob(store: GuardStore, data: BenefitJobData, now: string): Promise<void> {
  await store.collection<BenefitJob>("benefitJobs").insertIfAbsent(keyOf(data), { version: 0, data: cleanJob(data), createdAt: now, nextAttemptAt: now, attempts: 0 });
}

/** The same job as a create in a caller's atomic batch — for a job that must exist exactly when that batch's rows do. */
export function benefitJobWrite(data: BenefitJobData, now: string): GuardAtomicVersionedWrite {
  return { collection: "benefitJobs", key: keyOf(data), expectedVersion: null, next: { version: 0, data: cleanJob(data), createdAt: now, nextAttemptAt: now, attempts: 0 } as BenefitJob };
}

/**
 * The job due now: created if absent, or brought forward from its back-off — for a check whose answer has just come
 * (a person decided the wallet's case), so the person does not wait hours for the page to say so.
 */
export async function hurryBenefitJob(store: GuardStore, data: BenefitJobData, now: string): Promise<void> {
  const jobs = store.versioned<BenefitJob>("benefitJobs");
  const current = await jobs.get(keyOf(data));
  if (!current) return enqueueBenefitJob(store, data, now);
  if (Date.parse(current.nextAttemptAt) <= Date.parse(now)) return;
  await jobs.compareAndSet(keyOf(data), current.version, { ...current, version: current.version + 1, nextAttemptAt: now });
}

export async function completeBenefitJob(store: GuardStore, data: Pick<BenefitJobData, "wallet" | "kind" | "operationId">): Promise<void> {
  await store.collection("benefitJobs").delete(`${data.wallet}:${data.kind}:${data.operationId}`);
}

/** Leases reduce duplicate work; each underlying ledger still guarantees
 * idempotency if a process outlives its lease. No processor here moves funds. */
export async function drainBenefitJobs(store: GuardStore, args: Readonly<{
  now: string; wallet?: string; limit?: number; budgetMs?: number;
  /** Kinds this drain leaves for another (the page leaves the cluster check to the schedule). */
  exclude?: readonly BenefitJobData["kind"][];
  process: (data: BenefitJobData) => Promise<boolean>;
}>): Promise<Readonly<{ attempted: number; completed: number; pending: number }>> {
  const collection = store.versioned<BenefitJob>("benefitJobs");
  const rows = await collection.valuesWithPrefix(args.wallet ? `${args.wallet}:` : "");
  const due = rows.filter(row => Date.parse(row.nextAttemptAt) <= Date.parse(args.now) && !args.exclude?.includes(row.data.kind))
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
  const deadline = Date.now() + (args.budgetMs ?? 40_000);
  let attempted = 0, completed = 0;
  for (const row of due.slice(0, args.limit ?? 8)) {
    if (Date.now() >= deadline) break;
    const key = keyOf(row.data);
    /* The cluster check may wait days for a person: it backs off, doubling up to six hours, so it never crowds out the rest. */
    const delay = row.data.kind === "FIRST_TEN_CHECK" || row.data.kind === "REFERRAL_CHECK" ? Math.min(90_000 * 2 ** Math.min(row.attempts, 8), 6 * 3_600_000) : 90_000;
    const leased = { ...row, version: row.version + 1, attempts: row.attempts + 1, nextAttemptAt: new Date(Date.parse(args.now) + delay).toISOString() };
    if (!await collection.compareAndSet(key, row.version, leased)) continue;
    attempted++;
    try {
      if (await args.process(row.data)) { await collection.delete(key); completed++; }
    } catch { /* The lease expires and the same facts remain retryable. */ }
  }
  return { attempted, completed, pending: attempted - completed };
}
