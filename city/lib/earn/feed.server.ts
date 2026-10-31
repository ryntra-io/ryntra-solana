import 'server-only';
import { createSolanaRpcHandle, withRpcDiscipline } from '@/lib/solana/rpc';
import { EMPTY_ROW, rowFromPool, rowFromSanctum, type LstFeed, type LstRow } from './feed';
import { epochsPerYear, LSTS } from './lst';
import { decodeStakePool } from './stake-pool';

/**
 * The SOL Saver's yield feed, read on the server (CSP keeps the page on its own origin): the two SPL stake pools from
 * the chain itself — their worth in SOL now and at the epoch before, so the yield is the last epoch's, compounded over
 * the epochs of a year at the slot time the network kept lately — and Infinity from Sanctum's public figures, which is
 * a pool of LSTs rather than a stake pool. Kept two minutes for every visitor; a failed read leaves its row empty and
 * the window hides it, never an old figure called fresh.
 */

const SANCTUM = 'https://extra-api.sanctum.so/v1';
const SANCTUM_MS = 6_000;
const TTL_MS = 120_000;

let cache: Readonly<{ at: number; value: LstFeed }> | null = null;
let inflight: Promise<LstFeed> | null = null;

async function sanctum(path: string): Promise<unknown> {
  const response = await fetch(`${SANCTUM}${path}`, { signal: AbortSignal.timeout(SANCTUM_MS), headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function readChain(): Promise<Readonly<{ pools: Map<string, Uint8Array>; epoch: bigint | null; slotsPerEpoch: number | null; slotMs: number | null }>> {
  const handle = createSolanaRpcHandle({ network: 'mainnet' });
  const pools = LSTS.flatMap((lst) => (lst.source.kind === 'stake-pool' ? [lst.source.pool] : []));
  const [accounts, info, samples] = await Promise.allSettled([
    withRpcDiscipline(handle, (abortSignal) => handle.rpc.getMultipleAccounts(pools as never, { encoding: 'base64' }).send({ abortSignal })),
    withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal })),
    withRpcDiscipline(handle, (abortSignal) => handle.rpc.getRecentPerformanceSamples(30).send({ abortSignal })),
  ]);
  const read = new Map<string, Uint8Array>();
  if (accounts.status === 'fulfilled') {
    accounts.value.value.forEach((account, index) => {
      const data = account?.data as unknown as readonly [string, string] | undefined;
      if (data?.[0]) read.set(pools[index]!, new Uint8Array(Buffer.from(data[0], 'base64')));
    });
  }
  let slotMs: number | null = null;
  if (samples.status === 'fulfilled') {
    let slots = 0;
    let seconds = 0;
    for (const sample of samples.value) {
      slots += Number(sample.numSlots);
      seconds += Number(sample.samplePeriodSecs);
    }
    slotMs = slots > 0 ? (seconds * 1000) / slots : null;
  }
  return {
    pools: read,
    epoch: info.status === 'fulfilled' ? BigInt(info.value.epoch) : null,
    slotsPerEpoch: info.status === 'fulfilled' ? Number(info.value.slotsInEpoch) : null,
    slotMs,
  };
}

async function build(): Promise<LstFeed> {
  const sanctumLsts = LSTS.filter((lst) => lst.source.kind === 'sanctum');
  const query = sanctumLsts.map((lst) => `lst=${encodeURIComponent(lst.symbol)}`).join('&');
  const [chain, apys, values] = await Promise.allSettled([readChain(), sanctum(`/apy/latest?${query}`), sanctum(`/sol-value/current?${query}`)]);
  const c = chain.status === 'fulfilled' ? chain.value : null;
  const perYear = c && c.slotsPerEpoch !== null ? epochsPerYear(c.slotsPerEpoch, c.slotMs) : null;
  const lsts: LstRow[] = LSTS.map((lst) => {
    if (lst.source.kind === 'stake-pool') {
      const bytes = c?.pools.get(lst.source.pool);
      return rowFromPool(lst.id, lst.mint, bytes ? decodeStakePool(bytes) : null, c?.epoch ?? null, perYear);
    }
    const apyBody = apys.status === 'fulfilled' ? (apys.value as { apys?: unknown }).apys : null;
    const valueBody = values.status === 'fulfilled' ? (values.value as { solValues?: unknown }).solValues : null;
    return apyBody || valueBody ? rowFromSanctum(lst.id, lst.symbol, lst.decimals, apyBody, valueBody) : EMPTY_ROW(lst.id);
  });
  return { lsts, epochsPerYear: perYear, at: new Date().toISOString() };
}

export function readLstFeed(): Promise<LstFeed> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  if (inflight) return inflight;
  inflight = build()
    .then((value) => {
      // A read with no figure at all is not kept: the next visitor asks again.
      if (value.lsts.some((row) => row.rate !== null)) cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
