import { RULE_MAXIMUM_USD, RULE_MINIMUM_USD } from '../../../lib/autoinvest/limits.ts';
import { nextDueAfter, wallClockAt, type RuleSchedule } from '../../../lib/autoinvest/schedule.ts';
import { rawToDecimal, scaledDecimal, TRIGGER_V1_MIN_ORDER_USD } from '../../../lib/solana/limits/model.ts';
import { isBase, type Coin, type Side } from '../command/parse.ts';
import { SOL, USDC } from '../trade/tiles.ts';
import { missingOf, type Cadence, type Instruction, type Missing } from './types.ts';

/**
 * From a read instruction and what the engines say now to the exact request each existing engine takes (CITY-176).
 * Pure: the price, the wallet's holding, the clock and the time zone are arguments; nothing here asks, signs or sends.
 *
 * Every instruction runs on an engine Ryntra already has, and pays exactly what that engine's path pays:
 *
 * | Said | Engine | The person signs |
 * | --- | --- | --- |
 * | a regular purchase | «Регулярна купівля» rules (`/api/v1/rules`): a reminder on the schedule | once to set it (a message, no money); each purchase in their wallet |
 * | a limit | the spot limits engine (`/api/solana/limits`): a Jupiter Trigger V1 order, the coins in a program account of that order alone | once: the order |
 * | a stop | the engine's stops (CITY-149, `/api/v1/stops`): watched with the swap quote, the person told when reached | once to set it (a message); the sale in their wallet |
 *
 * Jupiter's own recurring orders are not used: Recurring V1 is no longer maintained, and its successor keeps the coins
 * in Jupiter's custodial vault and pays no integrator fee — neither keeps the money in the person's own hands.
 */

export const USDC_MINT = USDC.mint;
export const SOL_MINT = SOL.mint;

/** What the engines say now, for the card's figures and the requests. */
export type Facts = Readonly<{
  /** Dollars (USDC) per coin now, from the limits engine's market read; null while unread. */
  price: number | null;
  /** The coin's decimals, from the swap engine's quote or the wallet. */
  decimals: number | null;
  /** What the connected wallet can spend of the coin, raw units; null with no wallet or no read yet. */
  holdingRaw: string | null;
  /** Ryntra's fee on this trade by the engine's fee policy, basis points, from the swap quote. */
  feeBps: number | null;
}>;

export const NO_FACTS: Facts = { price: null, decimals: null, holdingRaw: null, feeBps: null };

export type Schedule = RuleSchedule;

export type Plan =
  | Readonly<{
      kind: 'recurring';
      coin: Coin;
      usd: number;
      schedule: Schedule;
      /** The first reminder, ms since the epoch: the instant the engine will remind at. */
      firstAt: number;
      /** `POST /api/v1/rules`. */
      body: Readonly<{ asset: Readonly<{ mint: string }>; amountUsd: number; kind: 'schedule'; schedule: Schedule; locale: 'en' | 'uk' }>;
    }>
  | Readonly<{
      kind: 'limit';
      side: Side;
      coin: Coin;
      /** Dollars per coin, as the engine takes it. */
      price: string;
      /** What is spent, as a plain decimal: dollars on a buy, the coin on a sale. */
      amount: string;
      /** The order's worth in dollars at its price. */
      usd: number;
    }>
  | Readonly<{
      kind: 'stop';
      side: Side;
      coin: Coin;
      price: string;
      amount: string;
      usd: number | null;
      /** `POST /api/v1/stops`. */
      body: Readonly<{
        side: Side;
        base: Readonly<{ mint: string; symbol: string; decimals: number; name: string }>;
        quote: Readonly<{ mint: string; symbol: string; decimals: number }>;
        amountRaw: string;
        price: string;
        expiry: 'never';
        locale: 'en' | 'uk';
      }>;
    }>;

/**
 * Why it cannot be signed as it stands:
 * - `PRICE` — the price now is not read yet (a move, or a direction the price now decides);
 * - `DECIMALS` — the coin's decimals are not read yet;
 * - `WALLET` — a sale's share needs the wallet's holding;
 * - `EMPTY` — the wallet holds none of the coin;
 * - `TOO_MUCH` — more than the wallet holds;
 * - `MIN` / `MAX` — under the engine's least (a limit $5, a regular purchase $1) or over its most;
 * - `PASSED` — the price is already past the line (a stop already reached; a limit that would fill at once).
 */
export type Problem = 'PRICE' | 'DECIMALS' | 'WALLET' | 'EMPTY' | 'TOO_MUCH' | 'MIN' | 'MAX' | 'PASSED';

export type Planned = Readonly<{ ok: true; plan: Plan }> | Readonly<{ ok: false; missing: Missing }> | Readonly<{ ok: false; problem: Problem }>;

/** The least each kind takes, in dollars: the venue's for a limit, the rules engine's for a regular purchase. */
export function minimumUsd(instruction: Instruction): number | null {
  if (instruction.kind === 'recurring') return RULE_MINIMUM_USD;
  return instruction.mode === 'stop' ? null : TRIGGER_V1_MIN_ORDER_USD;
}

/** A price as the engines take it: a plain decimal, six significant digits, never an exponent. */
export function priceText(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = value.toLocaleString('en-US', { maximumSignificantDigits: 6, useGrouping: false });
  return /^\d{1,18}(\.\d{1,18})?$/u.test(text) ? text : null;
}

/** The line the order waits for, in dollars: the price said, or the move from the price now in the order's direction. */
export function linePrice(instruction: Extract<Instruction, { kind: 'order' }>, now: number | null): string | null {
  const trigger = instruction.trigger;
  if (!trigger) return null;
  if (trigger.kind === 'price') return trigger.price;
  if (now === null || instruction.mode === null) return null;
  const down = (instruction.side === 'buy') === (instruction.mode === 'limit');
  return priceText(now * (down ? 1 - trigger.pct / 100 : 1 + trigger.pct / 100));
}

/** The kind the order is, once the price now is known: a buy under it is a limit, over it a stop; a sale the other way. */
export function modeOf(instruction: Extract<Instruction, { kind: 'order' }>, now: number | null): 'limit' | 'stop' | null {
  if (instruction.mode) return instruction.mode;
  const line = linePrice(instruction, now);
  if (line === null || now === null) return null;
  const below = Number(line) < now;
  return instruction.side === 'buy' ? (below ? 'limit' : 'stop') : below ? 'stop' : 'limit';
}

/** A plain decimal in raw units, or null when it carries more digits than the coin has. */
export function toRaw(decimal: string, decimals: number): string | null {
  // More digits than the coin carries is never rounded into it.
  if ((decimal.split('.')[1] ?? '').length > decimals) return null;
  const scaled = scaledDecimal(decimal, decimals);
  if (scaled === null || scaled <= 0n) return null;
  return scaled.toString();
}

/**
 * The schedule a regular purchase is set on: how often as said, the day and the time as said, else the next whole hour
 * on the person's clock — so the first purchase comes within the hour, never a week later by accident.
 */
export function scheduleOf(cadence: Cadence, said: Readonly<{ weekday: number | null; time: string | null }>, nowMs: number, timeZone: string): Schedule {
  const next = wallClockAt(nowMs + (60 - wallClockAt(nowMs, timeZone).minute) * 60_000, timeZone);
  const time = said.time ?? `${String(next.hour).padStart(2, '0')}:00`;
  const from = said.time ? wallClockAt(nowMs, timeZone) : next;
  return {
    cadence,
    weekday: cadence === 'weekly' ? (said.weekday ?? from.weekday) : null,
    monthDay: cadence === 'monthly' ? from.day : null,
    time,
    timeZone,
  };
}

/** The instruction as one request to its engine, or what it still needs, or why it cannot stand. */
export function planOf(instruction: Instruction, facts: Facts, env: Readonly<{ now: number; timeZone: string; locale: 'en' | 'uk' }>): Planned {
  const missing = missingOf(instruction);
  if (missing) return { ok: false, missing };
  const coin = instruction.coin!;

  if (instruction.kind === 'recurring') {
    const usd = Number(instruction.usd);
    if (!(usd >= RULE_MINIMUM_USD)) return { ok: false, problem: 'MIN' };
    if (usd > RULE_MAXIMUM_USD) return { ok: false, problem: 'MAX' };
    const schedule = scheduleOf(instruction.cadence!, instruction, env.now, env.timeZone);
    return {
      ok: true,
      plan: {
        kind: 'recurring',
        coin,
        usd,
        schedule,
        firstAt: nextDueAfter(schedule, env.now),
        body: { asset: { mint: coin.mint }, amountUsd: usd, kind: 'schedule', schedule, locale: env.locale },
      },
    };
  }

  const mode = modeOf(instruction, facts.price);
  const price = linePrice(instruction, facts.price);
  if (mode === null || price === null) return { ok: false, problem: 'PRICE' };
  const line = Number(price);
  // Past the line already: a stop that is reached now, a limit that would fill at once — said, never placed as is.
  if (facts.price !== null) {
    const under = line < facts.price;
    const passed = mode === 'limit' ? (instruction.side === 'buy' ? !under : under || line === facts.price) : instruction.side === 'sell' ? !under : under || line === facts.price;
    if (passed) return { ok: false, problem: 'PASSED' };
  }

  let amount: string;
  let amountRaw: string;
  let usd: number | null;
  if (instruction.side === 'buy') {
    amount = instruction.usd!;
    const raw = toRaw(amount, USDC.decimals);
    if (!raw) return { ok: false, problem: 'MIN' };
    amountRaw = raw;
    usd = Number(amount);
  } else {
    if (facts.decimals === null) return { ok: false, problem: 'DECIMALS' };
    const decimals = facts.decimals;
    if (instruction.share !== null) {
      if (facts.holdingRaw === null) return { ok: false, problem: 'WALLET' };
      const held = BigInt(facts.holdingRaw);
      if (held <= 0n) return { ok: false, problem: 'EMPTY' };
      const part = (held * BigInt(Math.round(instruction.share * 100))) / 10_000n;
      if (part <= 0n) return { ok: false, problem: 'MIN' };
      amountRaw = part.toString();
    } else {
      const raw = toRaw(instruction.count!, decimals);
      if (!raw) return { ok: false, problem: 'MIN' };
      if (facts.holdingRaw !== null && BigInt(raw) > BigInt(facts.holdingRaw)) return { ok: false, problem: BigInt(facts.holdingRaw) === 0n ? 'EMPTY' : 'TOO_MUCH' };
      amountRaw = raw;
    }
    amount = rawToDecimal(amountRaw, decimals);
    usd = Number(amount) * line;
  }

  if (mode === 'limit') {
    if (usd !== null && usd < TRIGGER_V1_MIN_ORDER_USD) return { ok: false, problem: 'MIN' };
    return { ok: true, plan: { kind: 'limit', side: instruction.side, coin, price, amount, usd: usd ?? 0 } };
  }

  // A stop's base needs its decimals for the engine's line, a buy's too.
  if (facts.decimals === null) return { ok: false, problem: 'DECIMALS' };
  return {
    ok: true,
    plan: {
      kind: 'stop',
      side: instruction.side,
      coin,
      price,
      amount,
      usd,
      body: {
        side: instruction.side,
        base: { mint: coin.mint, symbol: coin.symbol, decimals: facts.decimals, name: coin.name },
        quote: { mint: USDC_MINT, symbol: 'USDC', decimals: USDC.decimals },
        amountRaw,
        price,
        expiry: 'never',
        locale: env.locale,
      },
    },
  };
}

/** The coin the engines quote the pair on: SOL is its wrapped mint, every other coin its own. */
export function baseMintOf(coin: Coin): string {
  return isBase(coin) === 'SOL' ? SOL_MINT : coin.mint;
}

/** A tap's answer to what was missing: the instruction with that field written. */
export type Answer =
  | Readonly<{ field: 'coin'; coin: Coin }>
  | Readonly<{ field: 'cadence'; cadence: Cadence }>
  | Readonly<{ field: 'trigger'; price?: string; pct?: number }>
  | Readonly<{ field: 'size'; usd?: string; share?: number }>;

export function answer(instruction: Instruction, given: Answer): Instruction {
  switch (given.field) {
    case 'coin':
      return { ...instruction, coin: given.coin };
    case 'cadence':
      return instruction.kind === 'recurring' ? { ...instruction, cadence: given.cadence, options: {} } : instruction;
    case 'trigger':
      if (instruction.kind !== 'order') return instruction;
      if (given.price) return { ...instruction, trigger: { kind: 'price', price: given.price }, options: {} };
      if (given.pct) return { ...instruction, trigger: { kind: 'move', pct: given.pct }, mode: instruction.mode ?? (instruction.side === 'buy' ? 'limit' : 'stop'), options: {} };
      return instruction;
    case 'size':
      if (given.usd) return { ...instruction, usd: given.usd };
      if (given.share && instruction.kind === 'order') return { ...instruction, share: given.share, count: null };
      return instruction;
  }
}

/** The taps the card offers for what is missing: dollars, shares, moves in the order's own direction, cadences. */
export const USD_CHOICES = ['10', '20', '50', '100'] as const;
export const SHARE_CHOICES = [25, 50, 100] as const;
export const MOVE_CHOICES = [5, 10, 20] as const;
export const CADENCE_CHOICES: readonly Cadence[] = ['daily', 'weekly', 'monthly'];

/** Dollars the person sees in the card for a raw USDC amount, and the reverse — never through floating point. */
export function usdOfRaw(raw: string): string {
  return rawToDecimal(raw, USDC.decimals);
}

export function rawUsd(usd: string): string | null {
  return toRaw(usd, USDC.decimals);
}

/** One whole quote's worth for the fee and the decimals when the amount is not known yet: ten dollars. */
export const PROBE_USD = '10';
