import type { ProMarket, ProOrder, ProQuoteView } from '../../../lib/pro-limits/service.ts';

/**
 * «Buy cheaper», «sell higher» in the coin's window: the arithmetic between one slider and a ladder.
 *
 * The slider says one thing — how far from the price the ladder reaches. A buy goes down evenly, a per cent a step,
 * to 80 % under the price; a sale goes up by multiples — 5 % a step to twice the price, a quarter of the price a step
 * from there to ten times — since «2x» and «5x» are what a person means by selling higher. Both stop where the coin's
 * pool stops. What the ladder then is — its prices, what each pays — is the engine's answer, never worked out here.
 *
 * Pure: no store, no wallet, no network.
 */

export type LadderAction = 'buy' | 'sell';
export type Market = ProMarket;
export type Quote = ProQuoteView;
export type Order = ProOrder;

/** The slider's ends as the window draws them, and where it stands when the panel opens. */
export const SLIDER_MIN_BPS: Readonly<Record<LadderAction, number>> = { buy: 100, sell: 500 };
export const SLIDER_MAX_BPS: Readonly<Record<LadderAction, number>> = { buy: 8_000, sell: 90_000 };
export const SLIDER_START_BPS: Readonly<Record<LadderAction, number>> = { buy: 2_000, sell: 10_000 };

/** SOL a wallet keeps beside what a ladder rests: its rent — returned when the order is closed — its fees, and two accounts it may open. */
export const LADDER_SOL_ROOM_LAMPORTS = 45_000_000n;

export type Ends = Readonly<{ min: number; max: number }>;

/** The slider's ends on a market; null where the pool leaves no room for a ladder on that side. */
export function endsOf(action: LadderAction, market: Pick<Market, 'reach'>): Ends | null {
  const max = Math.min(SLIDER_MAX_BPS[action], action === 'buy' ? market.reach.buyBps : market.reach.sellBps);
  const min = SLIDER_MIN_BPS[action];
  return max >= min ? { min, max } : null;
}

/** A sale's step: 5 % to twice the price, a quarter of the price from there. */
const sellStep = (bps: number) => (bps < 10_000 ? 500 : 2_500);
const snap = (action: LadderAction, bps: number, ends: Ends) => {
  const step = action === 'buy' ? 100 : sellStep(bps);
  return Math.min(ends.max, Math.max(ends.min, Math.round(bps / step) * step));
};

/** How far the ladder reaches with the slider at `position` (0 to 100): linear for a buy, by multiples for a sale. */
export function bpsAt(position: number, action: LadderAction, ends: Ends): number {
  const at = Math.min(100, Math.max(0, position)) / 100;
  if (action === 'buy') return snap(action, ends.min + at * (ends.max - ends.min), ends);
  const low = Math.log(1 + ends.min / 10_000);
  const high = Math.log(1 + ends.max / 10_000);
  return snap(action, (Math.exp(low + at * (high - low)) - 1) * 10_000, ends);
}

/** Where the slider stands for a reach — the inverse of `bpsAt`, for a reach said in a sentence. */
export function positionOf(bps: number, action: LadderAction, ends: Ends): number {
  const held = Math.min(ends.max, Math.max(ends.min, bps));
  if (ends.max === ends.min) return 0;
  if (action === 'buy') return ((held - ends.min) / (ends.max - ends.min)) * 100;
  const low = Math.log(1 + ends.min / 10_000);
  const high = Math.log(1 + ends.max / 10_000);
  return ((Math.log(1 + held / 10_000) - low) / (high - low)) * 100;
}

/** The reach as a person reads it: «−20 %», «+50 %», «×2», «×2.5». Digits are the caller's to localise. */
export function reachText(bps: number, action: LadderAction): string {
  if (action === 'buy') return `−${trim(bps / 100)}%`;
  if (bps < 10_000) return `+${trim(bps / 100)}%`;
  return `×${trim(1 + bps / 10_000)}`;
}
const trim = (value: number) => String(Math.round(value * 100) / 100);

/** A typed amount as the coin's smallest units; null for what is not an amount. More decimals than the coin has are cut, never rounded up. */
export function rawOfText(text: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = (match[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  const raw = BigInt(match[1]! + fraction);
  return raw > 0n ? raw : null;
}

/** Smallest units as text for a field: no trailing zeros, a point for decimals. */
export function textOfRaw(raw: bigint, decimals: number): string {
  const digits = raw.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export type Held = Readonly<{ sol: bigint | null; quote: bigint | null; coin: bigint | null }>;

/** What a ladder may rest at the most, of what the wallet holds: the coin for a sale; for a buy the quote coin, less SOL's room where the quote is SOL. */
export function spendable(action: LadderAction, market: Pick<Market, 'quote'>, held: Held, solQuote: boolean): bigint | null {
  if (action === 'sell') return held.coin;
  if (held.quote === null) return null;
  if (!solQuote) return held.quote;
  return held.quote > LADDER_SOL_ROOM_LAMPORTS ? held.quote - LADDER_SOL_ROOM_LAMPORTS : 0n;
}

export type Problem = 'connect' | 'amount' | 'balance' | 'sol' | 'cap' | 'small' | 'paused';

/**
 * Why the ladder cannot be placed as it stands; null — it can. Told before the Review, in the window's own words: a
 * wallet not connected, no amount, more than is held, too little SOL for the order's rent, above the most one ladder
 * may rest, or prices smaller than the agent collects.
 */
export function problemOf(input: Readonly<{ market: Market; action: LadderAction; amountRaw: bigint | null; held: Held | null; solQuote: boolean; agent: boolean; quote: Quote | null }>): Problem | null {
  const { market, action, amountRaw, held, solQuote, agent, quote } = input;
  if (!market.placing) return 'paused';
  if (!held) return 'connect';
  if (amountRaw === null) return 'amount';
  const max = spendable(action, market, held, solQuote);
  if (max !== null && amountRaw > max) return 'balance';
  if (held.sol !== null && held.sol < LADDER_SOL_ROOM_LAMPORTS) return 'sol';
  /* Counted in the quote coin: what a buy spends, what a sale is paid once filled — known for a sale only once the engine quoted it. */
  const inQuote = action === 'buy' ? amountRaw : quote ? BigInt(quote.paysRaw) : null;
  if (market.cap.maxRaw !== null && inQuote !== null && inQuote > BigInt(market.cap.maxRaw)) return 'cap';
  if (agent && quote) {
    const least = quote.rungs.reduce<bigint | null>((low, rung) => {
      const value = BigInt(action === 'buy' ? rung.amountRaw : rung.paysRaw);
      return low === null || value < low ? value : low;
    }, null);
    if (least !== null && least < BigInt(market.cap.minRungRaw)) return 'small';
  }
  return null;
}

/** What identifies a quote: the same coin, side, reach, count and amount ask the engine once. */
export function quoteKey(mint: string, action: LadderAction, farBps: number, rungs: number | null, amountRaw: bigint): string {
  return `${mint}:${action}:${farBps}:${rungs ?? 'fit'}:${amountRaw}`;
}

/** An order as its row says it: what it does, and how far along it is. */
export function orderProgress(order: Pick<Order, 'state' | 'prices' | 'filledPrices'>): Readonly<{ filled: number; of: number; done: boolean }> {
  return { filled: order.filledPrices, of: order.prices, done: order.state === 'filled' || order.state === 'taken' };
}
