/**
 * Submit-once for one intent.
 *
 * No automatic duplicate submit. The cluster's `maxRetries: 0` only stops the
 * RPC from retrying a send; it does not stop this process from POSTing the
 * same signed bytes twice. This ledger does.
 *
 * The key is the compiled message hash — the fingerprint of the exact bytes
 * that were built. A second plan (new blockhash) is a new intent. A second
 * POST of the same plan is the duplicate this refuses.
 *
 * In-process. M1B's route wraps this with the durable canary intent ledger. A
 * caller outside that route still loses this local claim on process restart,
 * which is the honest limit of this row, not a claim that the cluster will.
 */

export type SubmitOnceRecord = Readonly<{
  key: string;
  signature: string | null;
  at: string;
}>;

const ledger = new Map<string, SubmitOnceRecord>();

export function intentKey(args: { network: string; messageHash: string }): string {
  return `${args.network}:${args.messageHash}`;
}

export function rememberIntent(args: { key: string; signature: string | null; at?: string }): SubmitOnceRecord {
  const record = { key: args.key, signature: args.signature, at: args.at ?? new Date().toISOString() };
  ledger.set(args.key, record);
  return record;
}

export function findIntent(key: string): SubmitOnceRecord | null {
  return ledger.get(key) ?? null;
}

/**
 * Refuse if this intent was already handed to the cluster. Returns the
 * existing record rather than sending again.
 */
export function claimIntent(key: string, at?: string): { ok: true } | { ok: false; record: SubmitOnceRecord } {
  const existing = ledger.get(key);
  if (existing) return { ok: false, record: existing };
  rememberIntent({ key, signature: null, at });
  return { ok: true };
}

/** Tests only — production never clears a spent intent. */
export function resetSubmitOnceForTests(): void {
  ledger.clear();
}
