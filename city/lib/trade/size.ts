import { exactDecimal } from '../../../lib/solana/amounts.ts';
import { PRIORITY_CEILING_LAMPORTS, SIGNATURE_LAMPORTS, TOKEN_ACCOUNT_RENT_LAMPORTS } from '../../../lib/spot/radar-cost.ts';
import { wordsNow } from '../i18n/dict.ts';
import { SOL, USDC, isBase, type Balance, type PayAsset, type Side } from './tiles.ts';
import { SIZE } from './words.ts';

/**
 * How much the card spends: one model for buying and selling, and for Market, Limit and Stop alike. The chips are
 * shares of what can be spent — 25 %, 50 %, 75 %, MAX — of the coin paid with when buying, of the coin sold when
 * selling; the slider is the same share from 0 to 100; the field takes any amount. The field's text is the amount: a
 * chip or the slider writes it, a typed amount puts the slider at its share, and a chip lights only when the amount is
 * exactly its share. Without a known balance there is nothing to take a share of: chips and slider rest, the field
 * works.
 */

export const SHARES = [25, 50, 75, 100] as const;
export type Share = (typeof SHARES)[number];

/**
 * SOL a swap that spends SOL leaves in the wallet beside the amount, over the reserve the engine's holdings already
 * keep back for a plain transfer (`NATIVE_SOL_FEE_RESERVE_LAMPORTS`, lib/solana/send-inventory.ts): the signature, the
 * highest priority fee a swap is built with, and the rent of the wrapped-SOL account the swap opens and closes inside
 * itself. Every figure is the engine's own (lib/spot/radar-cost.ts, held equal to lib/solana/jupiter-build.ts).
 */
export const SWAP_SOL_RESERVE_LAMPORTS = BigInt(SIGNATURE_LAMPORTS + PRIORITY_CEILING_LAMPORTS + TOKEN_ACCOUNT_RENT_LAMPORTS);
/** And the rent of the account the coin bought lands in, while the wallet holds none of it. */
export const NEW_ACCOUNT_RENT_LAMPORTS = BigInt(TOKEN_ACCOUNT_RENT_LAMPORTS);

/** Where a buy starts while the wallet covers it or is not known yet: a first trade should be a small one. */
const START_RAW: Readonly<Record<string, bigint>> = { [SOL.mint]: 100_000_000n, [USDC.mint]: 10_000_000n };
/** Otherwise a buy starts at this share of what can be spent. */
const START_SHARE: Share = 25;
/** The slider writes amounts a person reads: this many significant digits, rounded down. */
const SLIDE_DIGITS = 4;

/**
 * The most the card may spend of a balance: all of it, but for SOL less what the swap itself needs to land — and the
 * new account's rent when `opensAccount`. Null while the balance is unknown.
 */
export function spendMax(balance: Balance | null, spendsSol: boolean, opensAccount: boolean): bigint | null {
  if (!balance || !/^\d+$/.test(balance.spendableRaw)) return null;
  const all = BigInt(balance.spendableRaw);
  if (!spendsSol) return all;
  const keep = SWAP_SOL_RESERVE_LAMPORTS + (opensAccount ? NEW_ACCOUNT_RENT_LAMPORTS : 0n);
  return all > keep ? all - keep : 0n;
}

/** A share of the most, in hundredths of a percent, rounded down; 100 is the most itself. */
export function amountAt(max: bigint, share: number): bigint {
  if (!(share > 0) || max <= 0n) return 0n;
  if (share >= 100) return max;
  return (max * BigInt(Math.round(share * 100))) / 10_000n;
}

/** Where an amount stands against the most, 0–100 to the hundredth, rounded down; past the most is 100. */
export function shareOf(amount: bigint, max: bigint): number {
  if (max <= 0n || amount <= 0n) return 0;
  if (amount >= max) return 100;
  return Number((amount * 10_000n) / max) / 100;
}

/**
 * What the slider writes at a share: a short amount, rounded down — but a chip's share and the two ends exactly, so
 * the slider at 50 is the 50 % chip and at 100 is MAX.
 */
export function slideAmount(max: bigint, share: number, chips: readonly number[] = SHARES): bigint {
  const exact = amountAt(max, share);
  if (share <= 0 || share >= 100 || chips.includes(share)) return exact;
  const length = exact.toString().length;
  if (length <= SLIDE_DIGITS) return exact;
  const unit = 10n ** BigInt(length - SLIDE_DIGITS);
  return (exact / unit) * unit;
}

/** The field's text for an amount: exact, without a trailing zero; empty for nothing. */
export function amountText(raw: bigint, decimals: number): string {
  return raw > 0n ? exactDecimal(raw.toString(), decimals) : '';
}

export type Chip = Readonly<{
  /** 25, 50, 75, 100 — or the person's own sale chips (CITY-87, `city/lib/settings/trade.ts`). */
  share: number;
  /** 25%, 50%, 75%, MAX. */
  label: string;
  /** The exact amount the chip writes, in raw units of the coin spent. */
  amountRaw: string;
  /** The amount on the card is exactly this chip's. */
  on: boolean;
  /** There is something to take a share of. */
  usable: boolean;
}>;

export type Sizing = Readonly<{
  /** The most the card may spend, raw; null while the balance is unknown. */
  max: string | null;
  chips: readonly Chip[];
  /** Where the amount stands on the slider, 0–100; null while the slider rests. */
  share: number | null;
}>;

/**
 * The chips and the slider for an amount (raw, or null when the field holds none) against the most. `shares`: the
 * chips' shares — the person's own sale chips when selling (CITY-87); 25, 50, 75, MAX otherwise.
 */
export function sizingOf(max: bigint | null, amountRaw: string | null, shares: readonly number[] = SHARES): Sizing {
  const w = wordsNow(SIZE);
  const usable = max !== null && max > 0n;
  const amount = amountRaw && /^\d+$/.test(amountRaw) ? BigInt(amountRaw) : 0n;
  return {
    max: max === null ? null : max.toString(),
    chips: shares.map((share) => {
      const raw = usable ? amountAt(max, share) : 0n;
      return { share, label: share === 100 ? w.max : w.share(share), amountRaw: raw.toString(), on: raw > 0n && amount === raw, usable: raw > 0n };
    }),
    share: usable ? shareOf(amount, max) : null,
  };
}

/**
 * Where the amount starts. Selling, all of it. Buying with SOL or USDC, a small first amount — 0.1 SOL, 10 USDC —
 * while the wallet covers it or is not known yet, else a quarter of what it can spend; buying with any other coin of
 * the wallet, a quarter of it. Nothing when there is nothing to spend. `solStart`: the person's ⚡ amount in lamports
 * (CITY-87), in place of 0.1 SOL.
 */
export function startAmount(side: Side, pay: PayAsset, max: bigint | null, solStart?: bigint): bigint {
  if (side === 'sell') return max ?? 0n;
  const start = isBase(pay) ? (pay.mint === SOL.mint && solStart !== undefined && solStart > 0n ? solStart : START_RAW[pay.mint]) : undefined;
  if (start !== undefined && (max === null || start <= max)) return start;
  return max === null ? 0n : amountAt(max, START_SHARE);
}

/**
 * The slider's keyboard: the arrows move it by one, Page Up and Down by tens, Home and End to its ends. Null for any
 * other key. From an amount between steps the next step is the nearest whole share and one on.
 */
export function keyShare(share: number, key: string): number | null {
  const at = Math.round(share);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(100, at + 1);
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(0, at - 1);
    case 'PageUp':
      return Math.min(100, Math.floor(at / 10) * 10 + 10);
    case 'PageDown':
      return Math.max(0, Math.ceil(at / 10) * 10 - 10);
    case 'Home':
      return 0;
    case 'End':
      return 100;
    default:
      return null;
  }
}

/** The slider's share under a pointer at `x` across a track from `left`, `width` wide: whole shares, 0–100. */
export function pointerShare(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round(((x - left) / width) * 100)));
}
