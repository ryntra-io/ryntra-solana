import { displayAmount, scaleRawAmount } from '../../../lib/solana/amounts.ts';
import { dateText, digits, wordsNow } from '../i18n/dict.ts';
import { AGE_WORDS } from './words.ts';

/**
 * The wallet's coins as the engine reads them (`POST /api/solana/holdings`): every row the chain holds, SOL first,
 * with the engine's own name, its verdict on the coin and its price from Ryntra's catalogue. Nothing here prices a
 * coin: a value is the engine's price times the engine's amount, and a coin the catalogue does not price stays out of
 * the total and says so.
 */

export const NATIVE_ID = 'native:sol';

export type MoneyAsset = Readonly<{
  /** `native:sol`, or the mint. */
  id: string;
  native: boolean;
  mint: string | null;
  symbol: string;
  name: string | null;
  decimals: number;
  /** Everything held. */
  amountRaw: string;
  /** What a transfer may draw on: frozen accounts left out, and for SOL the fee reserve kept back by the engine. */
  spendableRaw: string;
  usdPrice: number | null;
  verified: boolean;
  suspicious: boolean;
  icon: string | null;
}>;

export type WalletRead = Readonly<{
  owner: string;
  assets: readonly MoneyAsset[];
  /** False when the chain answered by halves: what is missing is unknown, never zero. */
  complete: boolean;
  /** When the engine answered, ms since the epoch. */
  at: number;
}>;

type Row = Readonly<Record<string, unknown>>;

const DIGITS = /^\d+$/;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function short(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** The engine's holdings rows as coins. A row without whole figures is left out rather than guessed. */
export function assetsOf(rows: readonly unknown[]): MoneyAsset[] {
  const assets: MoneyAsset[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Row;
    const native = row.kind === 'NATIVE_SOL';
    const mint = native ? null : text(row.mint);
    if (!native && !mint) continue;
    const amountRaw = typeof row.amountRaw === 'string' && DIGITS.test(row.amountRaw) ? row.amountRaw : null;
    const spendableRaw = typeof row.spendableRaw === 'string' && DIGITS.test(row.spendableRaw) ? row.spendableRaw : null;
    const decimals = typeof row.decimals === 'number' && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 18 ? row.decimals : null;
    if (spendableRaw === null || decimals === null) continue;
    const held = amountRaw ?? spendableRaw;
    if (!native && BigInt(held) === 0n) continue;
    const catalog = row.catalog && typeof row.catalog === 'object' ? (row.catalog as Row) : null;
    const price = Number(catalog?.usdPrice);
    assets.push({
      id: native ? NATIVE_ID : (mint as string),
      native,
      mint,
      symbol: native ? 'SOL' : (text(catalog?.symbol) ?? text(row.symbol) ?? short(mint as string)),
      name: native ? 'Solana' : (text(catalog?.name) ?? text(row.name)),
      decimals,
      amountRaw: held,
      spendableRaw,
      usdPrice: Number.isFinite(price) && price > 0 ? price : null,
      verified: native || catalog?.isVerified === true,
      suspicious: catalog?.isSuspicious === true,
      icon: text(catalog?.icon),
    });
  }
  return assets;
}

/** What `raw` units are worth at the engine's price; null without a price. */
export function valueOf(asset: Pick<MoneyAsset, 'amountRaw' | 'decimals' | 'usdPrice'>, raw: string = asset.amountRaw): number | null {
  if (asset.usdPrice === null || !DIGITS.test(raw)) return null;
  const units = Number(scaleRawAmount(raw, asset.decimals).replace(/,/g, ''));
  return Number.isFinite(units) ? units * asset.usdPrice : null;
}

export type PortfolioRow = Readonly<{ asset: MoneyAsset; amount: string; valueUsd: number | null }>;

export type Portfolio = Readonly<{
  rows: readonly PortfolioRow[];
  /** The sum of the rows that have a value; null when none has. */
  totalUsd: number | null;
  /** Coins without a price: listed, never added. */
  unpriced: number;
}>;

/** The wallet as a list: SOL first, then the most valuable, verified coins before the rest. */
export function portfolioOf(assets: readonly MoneyAsset[]): Portfolio {
  const rows = assets.map((asset) => ({ asset, amount: displayAmount(asset.amountRaw, asset.decimals), valueUsd: valueOf(asset) }));
  rows.sort((a, b) => {
    if (a.asset.native !== b.asset.native) return a.asset.native ? -1 : 1;
    const value = (b.valueUsd ?? -1) - (a.valueUsd ?? -1);
    if (value !== 0) return value;
    return Number(b.asset.verified) - Number(a.asset.verified);
  });
  const valued = rows.filter((row) => row.valueUsd !== null);
  return {
    rows,
    totalUsd: valued.length ? valued.reduce((sum, row) => sum + (row.valueUsd as number), 0) : null,
    unpriced: rows.length - valued.length,
  };
}

/** The coins a transfer can draw on, SOL first: anything with a spendable balance, suspicious ones last. */
export function sendable(assets: readonly MoneyAsset[]): MoneyAsset[] {
  return assets
    .filter((asset) => BigInt(asset.spendableRaw) > 0n)
    .sort((a, b) => {
      if (a.native !== b.native) return a.native ? -1 : 1;
      if (a.suspicious !== b.suspicious) return a.suspicious ? 1 : -1;
      return (valueOf(b) ?? -1) - (valueOf(a) ?? -1);
    });
}

/** Dollars as the city writes them: $1,240 · $12.40 · <$0.01 · —. For the eye only: in the language on screen. */
export function formatUsd(value: number | null): string {
  return digits(usdText(value));
}

function usdText(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return '<$0.01';
  if (value >= 1_000_000) return `$${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 10_000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A coin amount for a row: grouped, at most six places — the exact figure lives on the Review. For the eye only. */
export function formatAmount(raw: string, decimals: number): string {
  return digits(amountText(raw, decimals));
}

function amountText(raw: string, decimals: number): string {
  const exact = displayAmount(raw, decimals);
  const [whole, fraction] = exact.split('.');
  if (!fraction) return whole;
  const kept = fraction.slice(0, whole === '0' ? 6 : 4).replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole === '0' ? `<0.${'0'.repeat(5)}1` : whole;
}

/** How old a read is: just now, 40s ago, 3 min ago, at 14:05. */
export function readAge(at: number, now: number): string {
  const w = wordsNow(AGE_WORDS);
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return w.justNow;
  if (s < 60) return w.seconds(s);
  if (s < 3600) return w.minutes(Math.floor(s / 60));
  return w.at(dateText(at, { hour: '2-digit', minute: '2-digit' }));
}
