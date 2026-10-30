import { exactDecimal, parseHumanAmount } from '../../../lib/solana/amounts.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import { AMOUNT_WORDS } from './words.ts';

/**
 * «How much» on Send and Bridge: what was typed, in the coin's own units, against what the wallet can spend. The
 * engine's parser decides what an amount is (`lib/solana/amounts.ts`): more decimals than the coin has is refused,
 * never rounded, because rounding would move a different amount. Spendable is the engine's figure — for SOL the fee
 * reserve is already kept back.
 */

export type AmountProblem = 'EMPTY' | 'NOT_A_NUMBER' | 'TOO_PRECISE' | 'ZERO' | 'OVER_BALANCE' | 'NO_BALANCE';

export type AmountRead = Readonly<{ ok: true; raw: string }> | Readonly<{ ok: false; problem: AmountProblem; text: string }>;

export type Spendable = Readonly<{ spendableRaw: string; decimals: number; symbol: string }>;

/** What a keyboard gives, as a plain decimal: a comma is a point, spaces and a second point go. */
export function cleanAmount(typed: string): string {
  const plain = typed.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const point = plain.indexOf('.');
  return point === -1 ? plain : `${plain.slice(0, point + 1)}${plain.slice(point + 1).replace(/\./g, '')}`;
}

export function readAmount(typed: string, spendable: Spendable | null): AmountRead {
  const w = wordsNow(AMOUNT_WORDS);
  const value = cleanAmount(typed);
  if (value === '' || value === '.') return { ok: false, problem: 'EMPTY', text: w.empty };
  if (!spendable) return { ok: false, problem: 'NO_BALANCE', text: w.noBalance };
  const normal = value.startsWith('.') ? `0${value}` : value.endsWith('.') ? value.slice(0, -1) : value;
  if (!/^\d+(\.\d+)?$/.test(normal)) return { ok: false, problem: 'NOT_A_NUMBER', text: w.notANumber };
  const fraction = normal.split('.')[1] ?? '';
  if (fraction.length > spendable.decimals) {
    return {
      ok: false,
      problem: 'TOO_PRECISE',
      text: w.tooPrecise(spendable.symbol, spendable.decimals),
    };
  }
  const parsed = parseHumanAmount(normal, spendable.decimals);
  if (!parsed.ok) return { ok: false, problem: 'ZERO', text: w.zero };
  if (BigInt(parsed.raw) > BigInt(spendable.spendableRaw)) {
    return { ok: false, problem: 'OVER_BALANCE', text: w.overBalance(digits(exactDecimal(spendable.spendableRaw, spendable.decimals)), spendable.symbol) };
  }
  return { ok: true, raw: parsed.raw };
}

/** A share of what can be spent, written back as the field takes it: `1/2` → half, `1/1` → all of it. */
export function shareOf(spendableRaw: string, decimals: number, numerator: bigint, denominator: bigint): string {
  if (!/^\d+$/.test(spendableRaw) || denominator <= 0n) return '';
  const raw = (BigInt(spendableRaw) * numerator) / denominator;
  return raw === 0n ? '' : exactDecimal(raw.toString(), decimals);
}
