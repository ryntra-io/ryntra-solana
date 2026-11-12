import type { PositionView } from '../../../lib/liquidity/catalog/positions.ts';
import { positionResult, type PositionEntry } from '../../../lib/liquidity/catalog/track.ts';
import type { LstFeed } from './feed.ts';
import { lamportsOf, LST_BY_MINT, LSTS, type LstId } from './lst.ts';

/**
 * «Mine» in SOL (CITY-95): what the wallet holds in Earn and how it stands against just holding SOL.
 *
 * - **LST balances** valued in SOL at the token's worth read from its pool.
 * - **The SOL Saver's lots** — what went in through Earn, kept on this device (the chain keeps no record of a
 *   purchase): their worth now against the SOL paid is what they earned, net of every cost on the way in.
 * - **Piers** — SOL-2b's own result (`lib/liquidity/catalog/track.ts`): the fees, and the position against the same
 *   tokens kept in the wallet; dollars turned into SOL at today's SOL price, both sides at the same prices.
 *
 * The headline only adds figures that are already SOL. Stocks and their dividends stay in their own units on their
 * own line. A figure that cannot be measured is null and left out, and the window says what is missing.
 */

/** One purchase through the SOL Saver: what it cost in lamports and what it brought in the LST's base units. */
export type SaverLot = Readonly<{ mint: string; lstRaw: string; lamports: string; at: number; signature: string }>;

const DIGITS = /^\d{1,30}$/;

export function readLot(raw: unknown): SaverLot | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.mint !== 'string' || !LST_BY_MINT.has(v.mint)) return null;
  if (typeof v.lstRaw !== 'string' || !DIGITS.test(v.lstRaw) || typeof v.lamports !== 'string' || !DIGITS.test(v.lamports)) return null;
  if (BigInt(v.lstRaw) <= 0n || BigInt(v.lamports) <= 0n) return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at) || typeof v.signature !== 'string' || v.signature.length > 100) return null;
  return { mint: v.mint, lstRaw: v.lstRaw, lamports: v.lamports, at: v.at, signature: v.signature };
}

export function readLots(raw: unknown): SaverLot[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SaverLot[] = [];
  for (const entry of raw) {
    const lot = readLot(entry);
    if (!lot || seen.has(lot.signature)) continue;
    seen.add(lot.signature);
    out.push(lot);
  }
  return out;
}

export type LstHolding = Readonly<{
  id: LstId;
  mint: string;
  symbol: string;
  raw: bigint;
  /** Worth in SOL now, lamports; null when the LST's worth was not read. */
  lamports: bigint | null;
  /** What the lots kept on this device for the balance still held cost, and what they are worth now. */
  tracked: Readonly<{ paid: bigint; worth: bigint }> | null;
}>;

/**
 * An LST balance with the part of it the device's lots account for: the lots, oldest first, up to the balance held
 * now — a balance that shrank sold the oldest first, pro rata within a lot. What came from elsewhere has no cost
 * here and earns no figure: never a guessed one.
 */
export function lstHolding(id: LstId, raw: bigint, feed: LstFeed | null, lots: readonly SaverLot[]): LstHolding {
  const lst = LSTS.find((l) => l.id === id)!;
  const rate = feed?.lsts.find((row) => row.id === id)?.rate ?? null;
  const lamports = lamportsOf(raw, rate);
  const mine = lots.filter((lot) => lot.mint === lst.mint).sort((a, b) => a.at - b.at);
  const bought = mine.reduce((sum, lot) => sum + BigInt(lot.lstRaw), 0n);
  let tracked: LstHolding['tracked'] = null;
  if (bought > 0n && raw > 0n && rate) {
    // Keep the newest lots that the balance still covers.
    let left = raw < bought ? raw : bought;
    let paid = 0n;
    let held = 0n;
    for (const lot of [...mine].reverse()) {
      if (left <= 0n) break;
      const size = BigInt(lot.lstRaw);
      const take = size < left ? size : left;
      paid += (BigInt(lot.lamports) * take) / size;
      held += take;
      left -= take;
    }
    const worth = lamportsOf(held, rate);
    tracked = worth === null ? null : { paid, worth };
  }
  return { id, mint: lst.mint, symbol: lst.symbol, raw, lamports, tracked };
}

export type PierStatus = 'in-range' | 'out-of-range' | 'filled';

export type PierRow = Readonly<{
  address: string;
  pair: string;
  status: PierStatus;
  /** SOL-2b's fees on the position, lamports at today's SOL price; null without the figures. */
  feesLamports: bigint | null;
  /** SOL-2b's net against holding the same tokens, lamports at today's SOL price; null without an entry or prices. */
  vsHoldLamports: bigint | null;
  /** The position's price bounds, Y per X (null on the plain curve): what tells two positions of one pair apart (CITY-243). */
  lower: number | null;
  upper: number | null;
}>;

function toLamports(usd: number | null, solUsd: number | null): bigint | null {
  if (usd === null || solUsd === null || !Number.isFinite(usd) || !(solUsd > 0)) return null;
  const lamports = (usd / solUsd) * 1e9;
  return Number.isFinite(lamports) ? BigInt(Math.round(lamports)) : null;
}

export function pierRow(view: PositionView, entry: PositionEntry | null, solUsd: number | null): PierRow {
  const result = positionResult(view, entry);
  const fees = result ? result.fees : view.unclaimedUsd;
  return {
    address: view.address,
    pair: view.name,
    status: view.rangeState === 'in_range' ? 'in-range' : 'out-of-range',
    feesLamports: toLamports(fees, solUsd),
    vsHoldLamports: result ? toLamports(result.net, solUsd) : null,
    lower: view.lower,
    upper: view.upper,
  };
}

export type Headline = Readonly<{
  /** Net, in SOL: the Saver's lots worth now less what they cost, and the piers' fees. Null when nothing is measured. */
  earned: bigint | null;
  /** Against just holding: the same lots (held SOL is what they cost), and the piers' SOL-2b net. Null when nothing is measured. */
  vsHold: bigint | null;
  /** Positions held with no figure of their own (bought elsewhere, an entry missing): left out of both and said so. */
  unmeasured: number;
}>;

export function headline(lsts: readonly LstHolding[], piers: readonly PierRow[]): Headline {
  let earned: bigint | null = null;
  let vsHold: bigint | null = null;
  let unmeasured = 0;
  const add = (a: bigint | null, b: bigint) => (a === null ? b : a + b);
  for (const lst of lsts) {
    if (lst.raw <= 0n) continue;
    if (!lst.tracked) {
      unmeasured += 1;
      continue;
    }
    const gain = lst.tracked.worth - lst.tracked.paid;
    earned = add(earned, gain);
    vsHold = add(vsHold, gain);
    // A balance bigger than its lots holds coins from elsewhere too.
    if (lst.lamports !== null && lst.tracked.worth < lst.lamports) unmeasured += 1;
  }
  for (const pier of piers) {
    if (pier.feesLamports !== null) earned = add(earned, pier.feesLamports);
    if (pier.vsHoldLamports !== null) vsHold = add(vsHold, pier.vsHoldLamports);
    else unmeasured += 1;
  }
  return { earned, vsHold, unmeasured };
}

/** The wallet's LSTs out of its coins, by mint: `{ mint, amountRaw }` rows as the engine read them. */
export function lstBalances(assets: readonly Readonly<{ mint: string | null; amountRaw: string }>[]): Map<LstId, bigint> {
  const out = new Map<LstId, bigint>();
  for (const asset of assets) {
    const lst = asset.mint ? LST_BY_MINT.get(asset.mint) : undefined;
    if (lst && DIGITS.test(asset.amountRaw) && BigInt(asset.amountRaw) > 0n) out.set(lst.id, BigInt(asset.amountRaw));
  }
  return out;
}
