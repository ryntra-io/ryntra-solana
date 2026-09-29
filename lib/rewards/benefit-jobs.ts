import type { GuardStore } from "../guard/store.ts";
import type { RyntraServiceFee } from "../swap/service-fee.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";

export type BenefitJobData = Readonly<{ wallet: string; operationId: string; settledAt: string }> & (
  | Readonly<{ kind: "REWARDS"; fee: RyntraServiceFee; providerUsd?: number | null; price?: Readonly<{ price: string; sourceRef: string; observedAt: string }> | null }>
  | Readonly<{ kind: "POINTS"; action: SolanaWalletAction; statedUsd?: Readonly<{ value: string; sourceRef: string }> | null }>
  | Readonly<{ kind: "CROSS_SWAP" }>
);
type BenefitJob = Readonly<{ version: number; data: BenefitJobData; createdAt: string; nextAttemptAt: string; attempts: number }>;
const keyOf = (data: BenefitJobData) => `${data.wallet}:${data.kind}:${data.operationId}`;

/** Only named financial facts are persisted; caller environments/dependencies
 * and any signing material are deliberately not part of this payload. */
export async function enqueueBenefitJob(store: GuardStore, data: BenefitJobData, now: string): Promise<void> {
  const base = { wallet: data.wallet, operationId: data.operationId, settledAt: data.settledAt };
  const clean: BenefitJobData = data.kind === "REWARDS"
    ? { ...base, kind: data.kind, fee: data.fee, providerUsd: data.providerUsd ?? null, ...(data.price !== undefined ? { price: data.price } : {}) }
    : data.kind === "POINTS" ? { ...base, kind: data.kind, action: data.action, statedUsd: data.statedUsd ?? null }
    : { ...base, kind: data.kind };
  await store.collection<BenefitJob>("benefitJobs").insertIfAbsent(keyOf(data), { version: 0, data: clean, createdAt: now, nextAttemptAt: now, attempts: 0 });
}

export async function completeBenefitJob(store: GuardStore, data: Pick<BenefitJobData, "wallet" | "kind" | "operationId">): Promise<void> {
  await store.collection("benefitJobs").delete(`${data.wallet}:${data.kind}:${data.operationId}`);
}

/** Leases reduce duplicate work; each underlying ledger still guarantees
 * idempotency if a process outlives its lease. No processor here moves funds. */
export async function drainBenefitJobs(store: GuardStore, args: Readonly<{
  now: string; wallet?: string; limit?: number; budgetMs?: number;
  process: (data: BenefitJobData) => Promise<boolean>;
}>): Promise<Readonly<{ attempted: number; completed: number; pending: number }>> {
  const collection = store.versioned<BenefitJob>("benefitJobs");
  const rows = await collection.valuesWithPrefix(args.wallet ? `${args.wallet}:` : "");
  const due = rows.filter(row => Date.parse(row.nextAttemptAt) <= Date.parse(args.now))
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
  const deadline = Date.now() + (args.budgetMs ?? 40_000);
  let attempted = 0, completed = 0;
  for (const row of due.slice(0, args.limit ?? 8)) {
    if (Date.now() >= deadline) break;
    const key = keyOf(row.data);
    const leased = { ...row, version: row.version + 1, attempts: row.attempts + 1, nextAttemptAt: new Date(Date.parse(args.now) + 90_000).toISOString() };
    if (!await collection.compareAndSet(key, row.version, leased)) continue;
    attempted++;
    try {
      if (await args.process(row.data)) { await collection.delete(key); completed++; }
    } catch { /* The lease expires and the same facts remain retryable. */ }
  }
  return { attempted, completed, pending: attempted - completed };
}
