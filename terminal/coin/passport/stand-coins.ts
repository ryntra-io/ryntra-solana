import type { SpotMarket, SpotStats } from '../../../lib/spot/markets.ts';
import type { RiskFact, TokenFacts, TokenWindowStats } from '../../../lib/spot/token-page.ts';
import type { PassportInput } from './passport-data.ts';

/**
 * The four coins the stand shows the passport on (`/terminal/kit/passport`, a stand only, never a person):
 * an old coin, a fresh coin on its launch curve, a coin no source names a creator for, and a coin with a risk. Their
 * figures are the stand's own, shaped exactly as the engine answers, on the clock of the moment the page opens; the
 * stand's live panel reads a real coin through the public reads. The same coins hold the tests (`passport.test.mjs`).
 */

export type StandKey = 'old' | 'fresh' | 'noCreator' | 'risky';
export const STAND_KEYS: readonly StandKey[] = ['old', 'fresh', 'noCreator', 'risky'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (at: number) => new Date(at).toISOString();

const stats = (over: Partial<SpotStats> = {}): SpotStats => ({ priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null, ...over });
const win = (over: Partial<TokenWindowStats> = {}): TokenWindowStats => ({
  priceChangePct: null,
  volumeUsd: null,
  buyVolumeUsd: null,
  sellVolumeUsd: null,
  buys: null,
  sells: null,
  traders: null,
  holderChangePct: null,
  liquidityChangePct: null,
  ...over,
});

type MarketOver = Partial<Omit<SpotMarket, 'audit' | 'stats'>> & { audit?: Partial<SpotMarket['audit']>; stats?: Partial<SpotMarket['stats']> };

function market(mint: string, symbol: string, over: MarketOver): SpotMarket {
  const { audit, stats: overStats, ...rest } = over;
  return {
    mint,
    symbol,
    name: symbol,
    icon: null,
    decimals: 6,
    tokenProgram: null,
    price: null,
    change24hPct: null,
    change1hPct: null,
    volume24hUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    holders: null,
    organicScore: null,
    organicScoreLabel: null,
    verified: false,
    tags: [],
    category: 'meme',
    issuer: null,
    firstPoolAt: null,
    links: { website: null, twitter: null, telegram: null },
    updatedAt: null,
    ...rest,
    audit: { mintAuthorityDisabled: null, freezeAuthorityDisabled: null, topHoldersPct: null, devBalancePct: null, suspicious: false, ...audit },
    stats: { h1: stats(), h24: stats(), ...overStats },
  };
}

function facts(mint: string, over: Partial<TokenFacts> & { m5?: Partial<TokenWindowStats>; h1?: Partial<TokenWindowStats>; h6?: Partial<TokenWindowStats>; h24?: Partial<TokenWindowStats> }): TokenFacts {
  const { m5, h1, h6, h24, ...rest } = over;
  return {
    mint,
    circulatingSupply: null,
    totalSupply: null,
    dev: null,
    devMints: null,
    devMigrations: null,
    launchpad: null,
    graduatedAt: null,
    createdAt: null,
    socials: [],
    ...rest,
    windows: { m5: win(m5), h1: win(h1), h6: win(h6), h24: win(h24) },
  };
}

const plain = (code: RiskFact['code'], value: number | null, state: string | null = null): RiskFact => ({ code, tone: 'plain', state, value, source: 'jupiter' });

/** A wallet that stands for a creator on the stand: base58, no real person's. */
const CREATOR = 'Crea7orStand1111111111111111111111111111111';

/** The four coins, as the three reads answer them, and the curve where one is read. */
export function standCoins(now: number): Readonly<Record<StandKey, PassportInput & Readonly<{ symbol: string }>>> {
  const old = 'StandOLD11111111111111111111111111111111111';
  const fresh = 'StandNEW11111111111111111111111111111111111';
  const bare = 'StandBARE1111111111111111111111111111111111';
  const risky = 'StandRSK11111111111111111111111111111111111';
  return {
    old: {
      symbol: 'LUMA',
      mint: old,
      now,
      market: market(old, 'LUMA', {
        verified: true,
        category: 'crypto',
        price: 0.8123,
        change24hPct: 3.42,
        change1hPct: 0.61,
        volume24hUsd: 48_200_000,
        liquidityUsd: 12_400_000,
        marketCapUsd: 1_140_000_000,
        fdvUsd: 2_430_000_000,
        holders: 812_400,
        firstPoolAt: iso(now - 2 * 365 * DAY - 40 * DAY),
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 41.2, devBalancePct: 3.8 },
        stats: { h24: stats({ traders: 18_420 }) },
      }),
      facts: facts(old, { dev: CREATOR, devMints: 2, devMigrations: 2, m5: { priceChangePct: 0.12 }, h1: { priceChangePct: 0.61 }, h6: { priceChangePct: -1.08 }, h24: { priceChangePct: 3.42, traders: 18_420, liquidityChangePct: 1.2 } }),
      risk: [plain('MINT_AUTHORITY', null, 'revoked'), plain('FREEZE_AUTHORITY', null, 'revoked'), plain('TOP10', 41.2), plain('CREATOR_HOLDS', 3.8), plain('CREATOR_TOKENS', 2), { code: 'HONEYPOT', tone: 'plain', state: 'no', value: null, source: 'geckoterminal' }],
    },
    fresh: {
      symbol: 'KITE',
      mint: fresh,
      now,
      market: market(fresh, 'KITE', {
        price: 0.0000412,
        change24hPct: 186.4,
        change1hPct: 42.7,
        volume24hUsd: 312_000,
        liquidityUsd: 38_600,
        marketCapUsd: 41_200,
        fdvUsd: 41_200,
        holders: 214,
        firstPoolAt: iso(now - 38 * MINUTE),
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 27.4, devBalancePct: 4.1 },
        stats: { h24: stats({ traders: 386 }) },
      }),
      facts: facts(fresh, { dev: CREATOR, devMints: 14, devMigrations: 1, launchpad: 'pump.fun', createdAt: iso(now - 38 * MINUTE), m5: { priceChangePct: 12.4 }, h1: { priceChangePct: 42.7 }, h6: { priceChangePct: 186.4 }, h24: { priceChangePct: 186.4, traders: 386 } }),
      risk: [plain('MINT_AUTHORITY', null, 'revoked'), plain('FREEZE_AUTHORITY', null, 'revoked'), plain('TOP10', 27.4), plain('CREATOR_HOLDS', 4.1), plain('CREATOR_TOKENS', 14)],
      curve: { progressPct: 63.2, complete: false },
    },
    noCreator: {
      symbol: 'MOSS',
      mint: bare,
      now,
      market: market(bare, 'MOSS', {
        price: 0.0214,
        change24hPct: -6.3,
        change1hPct: -0.4,
        volume24hUsd: 1_840_000,
        liquidityUsd: 920_000,
        marketCapUsd: 21_400_000,
        fdvUsd: 21_400_000,
        holders: 24_310,
        firstPoolAt: iso(now - 214 * DAY),
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 18.6 },
        stats: { h24: stats({ traders: 2_104 }) },
      }),
      facts: facts(bare, { launchpad: 'met-dbc', graduatedAt: iso(now - 213 * DAY), h1: { priceChangePct: -0.4 }, h6: { priceChangePct: -2.9 }, h24: { priceChangePct: -6.3, traders: 2_104 } }),
      risk: [plain('MINT_AUTHORITY', null, 'revoked'), plain('FREEZE_AUTHORITY', null, 'revoked'), plain('TOP10', 18.6)],
    },
    risky: {
      symbol: 'BRIX',
      mint: risky,
      now,
      market: market(risky, 'BRIX', {
        price: 0.00318,
        change24hPct: -38.2,
        change1hPct: -12.6,
        volume24hUsd: 96_000,
        liquidityUsd: 14_800,
        marketCapUsd: 318_000,
        fdvUsd: 1_590_000,
        holders: 1_402,
        firstPoolAt: iso(now - 3 * DAY - 5 * HOUR),
        audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPct: 68.4, devBalancePct: 22.5 },
        stats: { h24: stats({ traders: 512 }) },
      }),
      facts: facts(risky, { dev: CREATOR, devMints: 37, devMigrations: 0, m5: { priceChangePct: -2.2 }, h1: { priceChangePct: -12.6 }, h6: { priceChangePct: -24.1 }, h24: { priceChangePct: -38.2, traders: 512, liquidityChangePct: -44.6 } }),
      risk: [
        { code: 'MINT_AUTHORITY', tone: 'notice', state: 'active', value: null, source: 'jupiter' },
        { code: 'FREEZE_AUTHORITY', tone: 'notice', state: 'active', value: null, source: 'jupiter' },
        plain('TOP10', 68.4),
        plain('CREATOR_HOLDS', 22.5),
        plain('CREATOR_TOKENS', 37),
      ],
    },
  };
}
