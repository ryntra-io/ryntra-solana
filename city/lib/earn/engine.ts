import type { PositionsAnswer } from '../../../lib/liquidity/catalog/positions.ts';
import type { HarborPool } from '../districts/harbor/pools.ts';
import { readCaptainAnswer, type CaptainAnswer } from './captain.ts';
import { readFeed, type LstFeed } from './feed.ts';
import { readStocks, type ScaledConfig } from './stocks.ts';

/**
 * Earn's reads, all on Ryntra's own origin and all read-only: the LST yield feed and the Piers list (`/api/city/earn`),
 * the Scaled UI multipliers of the stocks a wallet holds, the lending markets of SOL-3 (`/api/solana/earn`, the
 * engine's own read, for the Dollar Saver's live context) and the wallet's pool positions (`/api/liquidity/positions`,
 * SOL-2b's read), and «Like the Captain»'s proven records (`/api/city/earn/captain`). Earn builds and signs nothing through here: the SOL Saver's swap is the trade card's engine.
 */

export type Read<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>;

export type GetLike = (url: string, init: Readonly<{ method: 'GET'; headers: Record<string, string>; signal: AbortSignal }>) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

/** The lending rates the Dollar Saver shows as context, per cent a year, as SOL-3's provider states them. */
export type LendRates = Readonly<{ usdc: number | null; sol: number | null; at: string | null }>;

export type EarnEngine = Readonly<{
  feed: () => Promise<Read<LstFeed>>;
  piers: () => Promise<Read<Readonly<{ pools: readonly HarborPool[]; at: string | null }>>>;
  stocks: (mints: readonly string[]) => Promise<Read<readonly ScaledConfig[]>>;
  lend: () => Promise<Read<LendRates>>;
  positions: (owner: string) => Promise<Read<PositionsAnswer>>;
  /** «Like the Captain»: the strategies with a proven record (CITY-99). */
  captain: () => Promise<Read<CaptainAnswer>>;
}>;

const READ_MS = 12_000;
const POSITIONS_MS = 32_000;

async function getJson(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<Read<unknown>> {
  const bound = new AbortController();
  const timer = setTimeout(() => bound.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: bound.signal });
    const json = await response.json().catch(() => null);
    if (!response.ok || json === null) return { ok: false, code: `HTTP_${response.status}` };
    return { ok: true, value: json };
  } catch {
    return { ok: false, code: bound.signal.aborted ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

/** USDC's and wrapped SOL's mints: Jupiter Lend names its SOL market «WSOL», so the rate is found by mint. */
const LEND_MINTS = { usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sol: 'So11111111111111111111111111111111111111112' } as const;

/** The supply rate of the first market of an asset among the providers that answered; null when none did. */
export function lendRates(surface: unknown): LendRates {
  const value = surface && typeof surface === 'object' ? (surface as Record<string, unknown>) : {};
  const providers = Array.isArray(value.providers) ? value.providers : [];
  const rate = (mint: string): number | null => {
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object' || (provider as { ok?: unknown }).ok !== true) continue;
      const markets = (provider as { markets?: unknown }).markets;
      if (!Array.isArray(markets)) continue;
      for (const market of markets) {
        const m = market as { asset?: { mint?: unknown }; rateAnnualPercent?: unknown };
        if (m?.asset?.mint === mint && typeof m.rateAnnualPercent === 'number' && Number.isFinite(m.rateAnnualPercent) && m.rateAnnualPercent >= 0 && m.rateAnnualPercent < 100) return m.rateAnnualPercent;
      }
    }
    return null;
  };
  return { usdc: rate(LEND_MINTS.usdc), sol: rate(LEND_MINTS.sol), at: typeof value.readAt === 'string' ? value.readAt : null };
}

export function createEarnEngine(fetchImpl: GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as GetLike): EarnEngine {
  const q = encodeURIComponent;
  return {
    feed: async () => {
      const read = await getJson(fetchImpl, '/api/city/earn', READ_MS);
      if (!read.ok) return read;
      const feed = readFeed(read.value);
      return feed ? { ok: true, value: feed } : { ok: false, code: 'SHAPE' };
    },
    piers: async () => {
      const read = await getJson(fetchImpl, '/api/city/earn/piers', READ_MS);
      if (!read.ok) return read;
      const body = read.value as { pools?: unknown; at?: unknown };
      return Array.isArray(body.pools) ? { ok: true, value: { pools: body.pools as HarborPool[], at: typeof body.at === 'string' ? body.at : null } } : { ok: false, code: 'SHAPE' };
    },
    stocks: async (mints) => {
      if (!mints.length) return { ok: true, value: [] };
      const read = await getJson(fetchImpl, `/api/city/earn/stocks?mints=${q(mints.join(','))}`, READ_MS);
      return read.ok ? { ok: true, value: readStocks(read.value) } : read;
    },
    lend: async () => {
      const read = await getJson(fetchImpl, '/api/solana/earn', READ_MS);
      return read.ok ? { ok: true, value: lendRates(read.value) } : read;
    },
    positions: async (owner) => {
      const read = await getJson(fetchImpl, `/api/liquidity/positions?owner=${q(owner)}`, POSITIONS_MS);
      if (!read.ok) return read;
      const answer = read.value as PositionsAnswer;
      return answer && answer.owner === owner && Array.isArray(answer.positions) ? { ok: true, value: answer } : { ok: false, code: 'SHAPE' };
    },
    captain: async () => {
      const read = await getJson(fetchImpl, '/api/city/earn/captain', READ_MS);
      if (!read.ok) return read;
      const answer = readCaptainAnswer(read.value);
      return answer ? { ok: true, value: answer } : { ok: false, code: 'SHAPE' };
    },
  };
}
