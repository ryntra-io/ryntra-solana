import type { PositionView } from '../../lib/liquidity/catalog/positions.ts';
import { positionResult, type PositionEntry } from '../../lib/liquidity/catalog/track.ts';
import type { HarborPool } from '../../city/lib/districts/harbor/pools.ts';
import { DOLLAR_DECIMALS, DOLLAR_MINT, type DollarAsset, type DollarMarket, type DollarPosition } from '../../city/lib/earn/dollar.ts';
import type { LstRow } from '../../city/lib/earn/feed.ts';
import { LSTS, SOL_MINT, type Lst } from '../../city/lib/earn/lst.ts';
import type { LstHolding } from '../../city/lib/earn/mine.ts';
import { rangeMark, solPiers, solShort, solUsd, STYLE_RISK, type Pier, type PierStyle } from '../../city/lib/earn/pier.ts';
import { proName, proOther, proSol, proStaked, type ProBoat, type ProPier } from '../../city/lib/earn/pro.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import { proResult, solUsd as resultUsd, type PoolResult, type ProLedger } from '../../lib/portfolio/pool-result.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';

/**
 * The Earn screen's rows, from what the city's Earn already reads: the pools, the wallet's positions, staking and
 * lending. Nothing here is a figure of its own — every number is the venue's, the chain's or the lending market's, put
 * into one table and, for the wallet's own positions, into dollars at the prices of the same read. A figure that was
 * not read is null, and the screen leaves its place empty.
 *
 * Pure: the screen and the tests read it alike.
 */

export type Coin = Readonly<{ mint: string; symbol: string }>;
export type Risk = 1 | 2 | 3;

/**
 * The dots of a position's width, on the city's own scale — the narrower the range, the sooner a move leaves it — and
 * one step calmer for a staked SOL against SOL, a pair that moves little.
 */
export function widthRisk(style: PierStyle, staked: boolean): Risk {
  const dots = STYLE_RISK[style];
  return staked && dots > 1 ? ((dots - 1) as Risk) : dots;
}

export type PoolRow = Readonly<{
  /** `pool:<address>` or `pro:<address>`: one table holds both. */
  key: string;
  kind: 'pool' | 'pro';
  address: string;
  /** «SOL · USDC», «JitoSOL · SOL». */
  name: string;
  /** The two coins in the name's order. */
  coins: readonly [Coin, Coin];
  /** What a trade pays the pool now, per cent. */
  feePct: number | null;
  /** What trades paid the pool's liquidity in 24 hours, dollars. */
  fees24hUsd: number | null;
  volume24hUsd: number | null;
  depthUsd: number | null;
  /** A staked SOL against SOL. */
  staked: boolean;
  /** Whether the pool takes a deposit at all. */
  takes: boolean;
}>;

/** A SOL pool's pair as the table names it: a staked SOL against SOL, or SOL against its other coin. */
export function pierName(pier: Pier): string {
  return pier.lst ? `${pier.lst.symbol} · SOL` : `SOL · ${pier.other.symbol}`;
}

function pierCoins(pier: Pier): readonly [Coin, Coin] {
  const sol = { mint: pier.sol.mint, symbol: 'SOL' };
  const other = { mint: pier.other.mint, symbol: pier.lst?.symbol ?? pier.other.symbol };
  return pier.lst ? [other, sol] : [sol, other];
}

/** The pools of the list as rows: the city's own SOL pools, the most paid in a day first. */
export function poolRows(pools: readonly HarborPool[]): PoolRow[] {
  return solPiers(pools)
    .map(
      (pier): PoolRow => ({
        key: `pool:${pier.pool.address}`,
        kind: 'pool',
        address: pier.pool.address,
        name: pierName(pier),
        coins: pierCoins(pier),
        feePct: pier.pool.feePct,
        fees24hUsd: pier.pool.lpFees24hUsd,
        volume24hUsd: pier.pool.volume24hUsd,
        depthUsd: pier.pool.tvlUsd,
        staked: pier.pair === 'lst',
        takes: true,
      }),
    )
    .sort((a, b) => (b.fees24hUsd ?? -1) - (a.fees24hUsd ?? -1));
}

/** The pools of DLMM Pro as rows of the same table: the chain gives their depth and fee; a day's fees it does not. */
export function proPoolRows(piers: readonly ProPier[], solPriceUsd: number | null): PoolRow[] {
  return piers.map((pier): PoolRow => {
    const sol = { mint: proSol(pier).mint, symbol: 'SOL' };
    const other = { mint: proOther(pier).mint, symbol: proOther(pier).symbol };
    const staked = proStaked(pier);
    return {
      key: `pro:${pier.address}`,
      kind: 'pro',
      address: pier.address,
      name: proName(pier),
      coins: staked ? [other, sol] : [sol, other],
      feePct: pier.feeBps / 100,
      fees24hUsd: null,
      volume24hUsd: null,
      depthUsd: pier.depthLamports === null ? null : lamportsUsd(BigInt(pier.depthLamports), solPriceUsd),
      staked,
      takes: pier.takesDeposits,
    };
  });
}

/** SOL's dollar price as the pools' venue states it: the first pool that prices it. */
export function venueSolUsd(pools: readonly HarborPool[]): number | null {
  for (const pier of solPiers(pools)) {
    const price = solUsd(pier);
    if (price !== null) return price;
  }
  return null;
}

/** Lamports in dollars at a SOL price; null without one. */
export function lamportsUsd(lamports: bigint, solPriceUsd: number | null): number | null {
  if (solPriceUsd === null || !(solPriceUsd > 0)) return null;
  const usd = (Number(lamports) / 1e9) * solPriceUsd;
  return Number.isFinite(usd) ? usd : null;
}

export type StakeRow = Readonly<{ lst: Lst; apyPct: number }>;

/** The staked SOL coins whose rate and worth were read: each is a row of the staking block; an unread one is not. */
export function stakeRows(rows: readonly LstRow[]): StakeRow[] {
  return LSTS.flatMap((lst) => {
    const row = rows.find((entry) => entry.id === lst.id);
    return row && row.apyPct !== null && row.rate !== null ? [{ lst, apyPct: row.apyPct }] : [];
  });
}

export type PositionRow = Readonly<{
  key: string;
  kind: 'pool' | 'stake' | 'lend' | 'pro';
  /** What the ticket opens on: the position's address, the Pro position's NFT, the staked coin's id, the lent coin. */
  ref: string;
  name: string;
  coins: readonly Coin[];
  /** What went in, dollars; null when nobody recorded it. */
  investedUsd: number | null;
  nowUsd: number | null;
  earnedUsd: number | null;
  /** A pool position inside its range; null where there is no range. */
  inRange: boolean | null;
  /** A pool position's range, English digits: what tells two positions of one pair apart. */
  mark: string | null;
  /**
   * A pool position against simply holding the coins that went in — the price's move, the fees, the costs — dollars;
   * null where what went in was not seen here, or no longer matches. Never a zero for an unknown.
   */
  vsHoldUsd?: number | null;
  /** A DLMM Pro position's whole result, in SOL (`lib/portfolio/pool-result.ts`). */
  result?: PoolResult | null;
}>;

/** A pool position: its worth and fees are the venue's dollars; what went in is the entry Ryntra kept when it opened here. */
export function poolPositionRow(view: PositionView, entry: PositionEntry | null): PositionRow {
  const result = positionResult(view, entry);
  return {
    key: `pool:${view.address}`,
    kind: 'pool',
    ref: view.address,
    name: view.name.replace(/\s*-\s*/g, ' · '),
    coins: [
      { mint: view.x.mint, symbol: view.x.symbol },
      { mint: view.y.mint, symbol: view.y.symbol },
    ],
    investedUsd: result && entry && entry.usd !== null ? entry.usd : null,
    nowUsd: view.valueUsd,
    earnedUsd: result ? result.fees : view.unclaimedUsd,
    inRange: view.rangeState === 'in_range',
    mark: rangeMark(view.lower, view.upper),
    vsHoldUsd: result ? result.net : null,
  };
}

/**
 * Staked SOL: its worth is the coin's own in SOL; what it cost and earned is known only for what went in through
 * Earn on this device. Dollars at today's SOL price, both sides alike.
 */
export function stakePositionRow(holding: LstHolding, solPriceUsd: number | null): PositionRow {
  const tracked = holding.tracked;
  // The cost is said only when the device's purchases account for the whole balance: part of it would misstate the rest.
  const whole = tracked !== null && holding.lamports !== null && tracked.worth >= holding.lamports;
  return {
    key: `stake:${holding.id}`,
    kind: 'stake',
    ref: holding.id,
    name: holding.symbol,
    coins: [{ mint: holding.mint, symbol: holding.symbol }],
    investedUsd: whole ? lamportsUsd(tracked.paid, solPriceUsd) : null,
    nowUsd: holding.lamports === null ? null : lamportsUsd(holding.lamports, solPriceUsd),
    earnedUsd: tracked ? lamportsUsd(tracked.worth - tracked.paid, solPriceUsd) : null,
    inRange: null,
    mark: null,
  };
}

/** A lending position: the market states its worth and what it earned, in the coin; dollars at the market's own price. */
export function lendPositionRow(position: DollarPosition, market: DollarMarket | null): PositionRow {
  const price = market?.priceUsd ?? null;
  const usd = (raw: bigint | null): number | null => (raw === null || price === null ? null : (Number(raw) / 10 ** DOLLAR_DECIMALS[position.asset]) * price);
  return {
    key: `lend:${position.asset}`,
    kind: 'lend',
    ref: position.asset,
    name: position.asset,
    coins: [{ mint: DOLLAR_MINT[position.asset], symbol: position.asset }],
    investedUsd: position.worthRaw !== null && position.earnedRaw !== null ? usd(position.worthRaw - position.earnedRaw) : null,
    nowUsd: usd(position.worthRaw),
    earnedUsd: usd(position.earnedRaw),
    inRange: null,
    mark: null,
  };
}

/**
 * A Pro position: the chain states its worth and fees in SOL; what went in, and the result against holding, only where
 * this device saw the opening (`ledger`). Dollars at today's SOL price.
 */
export function proPositionRow(boat: ProBoat, pier: ProPier, solPriceUsd: number | null, ledger: ProLedger | null = null): PositionRow {
  const sol = { mint: proSol(pier).mint, symbol: 'SOL' };
  const other = { mint: proOther(pier).mint, symbol: proOther(pier).symbol };
  const result = proResult(ledger, boat, pier);
  return {
    key: `pro:${boat.nftMint}`,
    kind: 'pro',
    ref: boat.nftMint,
    name: proName(pier),
    coins: proStaked(pier) ? [other, sol] : [sol, other],
    investedUsd: result.unknown === 'entry' ? null : resultUsd(result.invested, solPriceUsd),
    nowUsd: lamportsUsd(BigInt(boat.worth.lamports), solPriceUsd),
    // Everything it earned where the entry is known — still in it, taken, put back — else what it holds to take now.
    earnedUsd: result.fees !== null ? resultUsd(result.fees, solPriceUsd) : lamportsUsd(BigInt(boat.fees.lamports), solPriceUsd),
    inRange: boat.empty ? null : boat.inRange,
    mark: boat.empty ? null : rangeMark(boat.lowerPrice, boat.upperPrice),
    vsHoldUsd: resultUsd(result.net, solPriceUsd),
    result,
  };
}

export type PositionsInput = Readonly<{
  views: readonly PositionView[];
  entries: ReadonlyMap<string, PositionEntry>;
  staked: readonly LstHolding[];
  lent: readonly DollarPosition[];
  markets: Readonly<Partial<Record<DollarAsset, DollarMarket | null>>>;
  proBoats: readonly ProBoat[];
  proPiers: readonly ProPier[];
  solPriceUsd: number | null;
  /** What this device saw go into its DLMM Pro positions, by the position's NFT. */
  ledgers?: ReadonlyMap<string, ProLedger>;
}>;

/** Everything the wallet has at work, in the table's order: pools, then staking, then lending. */
export function positionRows(input: PositionsInput): PositionRow[] {
  const pro = input.proBoats.flatMap((boat) => {
    const pier = input.proPiers.find((entry) => entry.address === boat.pool);
    return pier ? [proPositionRow(boat, pier, input.solPriceUsd, input.ledgers?.get(boat.nftMint) ?? null)] : [];
  });
  return [
    ...input.views.map((view) => poolPositionRow(view, input.entries.get(view.address) ?? null)),
    ...pro,
    ...input.staked.filter((holding) => holding.raw > 0n).map((holding) => stakePositionRow(holding, input.solPriceUsd)),
    ...input.lent.map((position) => lendPositionRow(position, input.markets[position.asset] ?? null)),
  ];
}

/** «At work» and «Earned»: the sums of the figures that were read; null when none was. */
export function totals(rows: readonly PositionRow[]): Readonly<{ workingUsd: number | null; earnedUsd: number | null }> {
  const sum = (pick: (row: PositionRow) => number | null): number | null => {
    const read = rows.map(pick).filter((value): value is number => value !== null);
    return read.length ? read.reduce((a, b) => a + b, 0) : null;
  };
  return { workingUsd: sum((row) => row.nowUsd), earnedUsd: sum((row) => row.earnedUsd) };
}

/** Dollars to the cent, in the language's own digits: «$1,240.00», «$1 240,00»; signed for a result. */
export function sumText(usd: number | null, lang: Lang, signed = false): string {
  if (usd === null || !Number.isFinite(usd)) return '—';
  const cents = Math.round(Math.abs(usd) * 100) / 100;
  const body = cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = cents === 0 ? '' : usd < 0 ? '−' : signed ? '+' : '';
  return digits(`${sign}$${body}`, lang);
}

const SHORT_UNITS: Readonly<Record<Lang, readonly [string, string, string]>> = { en: ['K', 'M', 'B'], uk: [' тис.', ' млн', ' млрд'] };

/** Dollars, short, as the table writes a day's fees and a pool's depth: «$8.9K», «$21,2 млн», and to the cent under a thousand. */
export function shortUsd(usd: number | null, lang: Lang): string {
  if (usd === null || !Number.isFinite(usd)) return '—';
  const [k, m, b] = SHORT_UNITS[lang] ?? SHORT_UNITS.en;
  // Each step starts where the one below would round up to a thousand: 999.96K reads 1.0M, never 1000.0K.
  if (usd >= 999_950_000) return digits(`$${(usd / 1e9).toFixed(2)}`, lang) + b;
  if (usd >= 999_950) return digits(`$${(usd / 1e6).toFixed(1)}`, lang) + m;
  if (usd >= 999.995) return digits(`$${(usd / 1e3).toFixed(1)}`, lang) + k;
  return sumText(usd, lang);
}

/**
 * Dollars in a phone's narrow column (G6, fault 39): two significant figures under ten of a unit, three above, the
 * language's own unit, never a trailing «,0» — «$780 тис.», «$2,1 млн», «$19,6 тис.», «$1,8 тис.», «$960».
 */
export function tightUsd(usd: number | null, lang: Lang): string {
  if (usd === null || !Number.isFinite(usd)) return '—';
  const [k, m, b] = SHORT_UNITS[lang] ?? SHORT_UNITS.en;
  const tight = (value: number) => String(Number(value.toPrecision(value < 9.95 ? 2 : 3)));
  if (usd >= 999_500_000) return digits(`$${tight(usd / 1e9)}`, lang) + b;
  if (usd >= 999_500) return digits(`$${tight(usd / 1e6)}`, lang) + m;
  if (usd >= 999.5) return digits(`$${tight(usd / 1e3)}`, lang) + k;
  return digits(`$${Math.round(usd)}`, lang);
}

/** A pool's trade fee: «0.04%», «0.10%», and a third place under a hundredth of a per cent. */
export function feeText(feePct: number | null, lang: Lang): string {
  if (feePct === null || !Number.isFinite(feePct)) return '—';
  return digits(`${feePct.toFixed(feePct > 0 && feePct < 0.01 ? 3 : 2)}%`, lang);
}

/** The tone of a result: growth mint, a loss flare, nothing for none. */
export function resultTone(usd: number | null): 'up' | 'down' | undefined {
  if (usd === null) return undefined;
  const cents = Math.round(usd * 100);
  return cents > 0 ? 'up' : cents < 0 ? 'down' : undefined;
}

/**
 * A Pro action's rewards as «0.42 USDC + 1.1 JitoSOL»: each in its own coin, only a coin of the pool's own, whose decimals
 * are known — as the city reads them (`city/lib/earn/pro.ts`); one in another coin is left out, never shown in raw units.
 */
export function proRewardsText(pier: Pick<ProPier, 'x' | 'y'>, rewards: readonly Readonly<{ mint: string; symbol: string | null; leastRaw: string }>[]): string {
  return rewards
    .flatMap((reward) => {
      const decimals = reward.mint === pier.x.mint ? pier.x.decimals : reward.mint === pier.y.mint ? pier.y.decimals : null;
      if (decimals === null || reward.symbol === null || !/^\d+$/.test(reward.leastRaw) || BigInt(reward.leastRaw) <= 0n) return [];
      return [`${solShort(Number(BigInt(reward.leastRaw)) / 10 ** decimals)} ${reward.symbol}`];
    })
    .join(' + ');
}

/** The SOL mint, for the screens that name the coin an amount is typed in. */
export const SOL: Coin = { mint: SOL_MINT, symbol: 'SOL' };
