/**
 * The payout record in this browser: each payout sealed on its own under `payout:<network>:<owner>:<id>` with the
 * private balance's own sealing (`../vault.client.ts` — the same non-exportable key, the same store). Nothing here goes
 * to a server. Writing a payout marks the key copy as due, since the copy now carries more.
 *
 * The record's line in the key copy is sealed with the viewing key this browser keeps for the wallet (`keysId`). When
 * the keys come from the wallet instead, the viewing key is handed in from there — `copyLine` and
 * `restoreFrom` take it as an argument for that reason.
 */

import { copiedId, ids, keysId, seal, unseal, type StoredKeys } from '../vault.client.ts';
import { decodeLedgerCopy, encodeLedgerCopy } from './copy.ts';
import { LEDGER_KEEP, isRecord, newestFirst, type PayoutRecord } from './ledger.ts';

const idOf = (network: string, owner: string, id: string) => `payout:${network}:${owner}:${id}`;

export async function readLedger(network: string, owner: string): Promise<PayoutRecord[]> {
  const out: PayoutRecord[] = [];
  for (const id of await ids(`payout:${network}:${owner}:`)) {
    const record = await unseal<unknown>(id);
    if (isRecord(record)) out.push(record);
  }
  return newestFirst(out).slice(0, LEDGER_KEEP);
}

/** Writes (or rewrites) one payout; the key copy is due again. */
export async function writePayout(network: string, owner: string, record: PayoutRecord): Promise<void> {
  await seal(idOf(network, owner, record.id), record);
  await seal(copiedId(network, owner), false);
}

/** The viewing key this browser keeps for the wallet; null when it keeps none. */
export async function keptViewingKey(network: string, owner: string): Promise<Uint8Array | null> {
  const stored = await unseal<StoredKeys>(keysId(network, owner));
  return stored ? Uint8Array.from(stored.viewing) : null;
}

/** The record's line for the key copy; null when there is nothing to keep or no key to seal it with. */
export async function copyLine(network: string, owner: string, viewing: Uint8Array | null = null): Promise<string | null> {
  const key = viewing ?? (await keptViewingKey(network, owner));
  if (!key) return null;
  try {
    return await encodeLedgerCopy(await readLedger(network, owner), network, owner, key);
  } finally {
    if (!viewing) key.fill(0);
  }
}

/** Puts back the payouts a key copy carries; how many came back, or null when the text has none for this wallet. */
export async function restoreFrom(text: string, network: string, owner: string, viewing: Uint8Array | null = null): Promise<number | null> {
  const key = viewing ?? (await keptViewingKey(network, owner));
  if (!key) return null;
  try {
    const records = await decodeLedgerCopy(text, network, owner, key);
    if (!records) return null;
    const have = new Set((await readLedger(network, owner)).map((r) => r.id));
    let added = 0;
    for (const record of records) {
      if (have.has(record.id) || record.network !== network) continue;
      await seal(idOf(network, owner, record.id), record);
      added += 1;
    }
    return added;
  } finally {
    if (!viewing) key.fill(0);
  }
}
