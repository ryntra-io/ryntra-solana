/**
 * The ring's counter: how much money is in the ring now and how many private balances there are — the honest
 * measure of how easy a hidden amount is to guess (research 19.11: «the fewer people in the ring, the easier to
 * guess»). Read on the server only, through Helius with the server's key; kept a minute in the warm instance and at the
 * edge, so a page that opens it costs the ring nothing more.
 *
 * Two reads, one JSON-RPC batch:
 * - the SOL in the ring: the balance of the ring's SOL vault — the fixed address the SDK names for every SOL deposit and
 *   withdrawal (`CiNm…pLXE`, PROBE.md; the bundle's `Wu()`);
 * - the private balances: the address registry's user records — accounts of 100 bytes that start with byte 1, as the
 *   SDK reads one (`WALLET_INVALID_USER_RECORD` otherwise) — counted without their data.
 *
 * On the network the private balance runs on (`network.ts`) — the ring's programs carry the same addresses on both
 * networks, so the vault and the registry are the same; each network's read is kept apart. The ring's other coins are not
 * counted: the private balance holds SOL alone. A read that fails says «unknown» (null), never zero.
 */

import type { PrivateNetwork } from './network.ts';
import { upstreamUrl } from './relay.ts';

export const RING_SOL_VAULT = 'CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE';
export const RING_REGISTRY = 'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ';
/** A user record of the registry: its size and its first byte (base58 of byte 1). */
export const USER_RECORD_BYTES = 100;
const USER_RECORD_MARK = '2';

/** How long a read is kept before the next one asks the chain again. */
export const RING_COUNT_KEEP_MS = 60_000;
const READ_TIMEOUT_MS = 8_000;

export type RingCount = Readonly<{
  network: PrivateNetwork;
  /** SOL in the ring, in lamports as a decimal string; null when it could not be read. */
  lamports: string | null;
  /** Private balances in the registry; null when they could not be counted. */
  balances: number | null;
  /** When the chain was read. */
  readAt: string;
}>;

/** The batch the counter sends: the vault's balance, then the registry's user records without their data. */
export function ringCountBatch(): readonly Readonly<Record<string, unknown>>[] {
  return [
    { jsonrpc: '2.0', id: 'vault', method: 'getBalance', params: [RING_SOL_VAULT, { commitment: 'confirmed' }] },
    {
      jsonrpc: '2.0',
      id: 'registry',
      method: 'getProgramAccounts',
      params: [RING_REGISTRY, { commitment: 'confirmed', encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: USER_RECORD_BYTES }, { memcmp: { offset: 0, bytes: USER_RECORD_MARK } }] }],
    },
  ];
}

function answerOf(batch: unknown, id: string): unknown {
  if (!Array.isArray(batch)) return undefined;
  const found = batch.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === id) as { result?: unknown; error?: unknown } | undefined;
  return found && found.error === undefined ? found.result : undefined;
}

/** The vault's lamports from the batch's answer, or null. */
export function lamportsFrom(batch: unknown): string | null {
  const result = answerOf(batch, 'vault') as { value?: unknown } | number | undefined;
  const value = typeof result === 'number' ? result : (result as { value?: unknown } | undefined)?.value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}

/** The count of user records from the batch's answer, or null. */
export function balancesFrom(batch: unknown): number | null {
  const result = answerOf(batch, 'registry') as unknown;
  const list = Array.isArray(result) ? result : Array.isArray((result as { value?: unknown } | undefined)?.value) ? (result as { value: unknown[] }).value : null;
  return list ? list.length : null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const kept = new Map<PrivateNetwork, Readonly<{ at: number; count: RingCount }>>();
const flights = new Map<PrivateNetwork, Promise<RingCount | null>>();

/** Forget the kept read (tests). */
export function forgetRingCount(): void {
  kept.clear();
  flights.clear();
}

/**
 * The ring's counter on a network: the kept read while it is fresh, else one batch to Helius. Without a key — null. A
 * read that fails keeps the last good one if there is one, else null.
 */
export async function readRingCount({ key, network = 'devnet', fetchImpl = fetch, now = Date.now }: { key: string; network?: PrivateNetwork; fetchImpl?: Fetch; now?: () => number }): Promise<RingCount | null> {
  const last = kept.get(network);
  if (last && now() - last.at < RING_COUNT_KEEP_MS) return last.count;
  const url = upstreamUrl('rpc', [], '', key, network);
  if (!url) return null;
  const flying = flights.get(network);
  if (flying) return flying;
  const read = (async (): Promise<RingCount | null> => {
    const answer = await fetchImpl(url.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(ringCountBatch()),
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    }).catch(() => null);
    const batch: unknown = answer?.ok ? await answer.json().catch(() => null) : null;
    const lamports = lamportsFrom(batch);
    const balances = balancesFrom(batch);
    if (lamports === null && balances === null) return kept.get(network)?.count ?? null;
    const count: RingCount = { network, lamports, balances, readAt: new Date(now()).toISOString() };
    kept.set(network, { at: now(), count });
    return count;
  })().finally(() => {
    flights.delete(network);
  });
  flights.set(network, read);
  return read;
}
