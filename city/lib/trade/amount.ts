import { parseHumanAmount } from '../../../lib/solana/amounts.ts';
import { formatUnits } from './format.ts';
import type { Balance } from './tiles.ts';

/**
 * The amount in the card's field, typed or written there by a chip or the slider (`size.ts`). It becomes an exact raw
 * amount of what is spent, or a plain sentence saying what is wrong with it. Never more than the wallet can spend.
 */

export type AmountProblem = Readonly<{ kind: 'format' | 'zero' | 'decimals' | 'balance'; text: string }>;

export type Typed = Readonly<{ ok: true; amountRaw: string }> | Readonly<{ ok: false; problem: AmountProblem }>;

/** Longest text the field keeps: far more digits than any balance has. */
const LONGEST = 24;

/**
 * What the field keeps of a keystroke: digits, one point and any commas. Commas are kept as typed, so the whole
 * amount decides what a comma means (`decimalText`), never the keystroke that typed it.
 */
export function cleanAmountInput(text: string): string {
  let point = false;
  let out = '';
  for (const char of text) {
    if ((char >= '0' && char <= '9') || char === ',') out += char;
    else if (char === '.' && !point) {
      point = true;
      out += char;
    }
  }
  return out.slice(0, LONGEST);
}

const COMMA_TEXT = 'Type the amount with a point and no commas, like 1000 or 2.5.';

/**
 * The field's text with a point for decimals, or null when a comma in it could mean two things. One comma and no
 * point is the decimal comma («12,5», «0,125»); a comma beside a point, several commas, or one comma before exactly
 * three digits («1,000» — a thousand or one?) is refused rather than guessed.
 */
function decimalText(clean: string): string | null {
  const commas = clean.split(',').length - 1;
  if (commas === 0) return clean;
  if (commas > 1 || clean.includes('.')) return null;
  const [whole = '', fraction = ''] = clean.split(',');
  if (fraction.length === 3 && /[1-9]/.test(whole)) return null;
  return `${whole}.${fraction}`;
}

/**
 * The typed amount in raw units of `symbol`, or why it cannot be one; null while the field is empty. Without a known
 * balance it is taken as it is and the engine has the last word. `keepsFee`: the balance given is already what may be
 * spent once the network is paid (SOL, `spendMax`), and the sentence says so.
 */
export function typedAmount(text: string, asset: Readonly<{ symbol: string; decimals: number }>, balance: Balance | null, keepsFee = false): Typed | null {
  const decimal = decimalText(cleanAmountInput(text));
  if (decimal === null) return { ok: false, problem: { kind: 'format', text: COMMA_TEXT } };
  let clean = decimal;
  if (clean.endsWith('.')) clean = clean.slice(0, -1);
  if (clean.startsWith('.')) clean = `0${clean}`;
  if (!clean) return null;
  const parsed = parseHumanAmount(clean, asset.decimals);
  if (!parsed.ok) {
    const fraction = clean.split('.')[1] ?? '';
    if (/^\d+(\.\d+)?$/.test(clean) && fraction.length > asset.decimals) {
      const text = asset.decimals === 0 ? `${asset.symbol} comes in whole numbers only.` : `${asset.symbol} has at most ${asset.decimals} digits after the point.`;
      return { ok: false, problem: { kind: 'decimals', text } };
    }
    if (/^[0.]+$/.test(clean)) return { ok: false, problem: { kind: 'zero', text: 'Type an amount above zero.' } };
    return { ok: false, problem: { kind: 'format', text: 'Type a number, like 2.5.' } };
  }
  if (balance && BigInt(parsed.raw) > BigInt(balance.spendableRaw)) {
    const have = formatUnits(balance.spendableRaw, balance.decimals, 'down');
    const text = keepsFee ? `Up to ${have} ${asset.symbol}: the rest pays the network.` : `You have ${have} ${asset.symbol}. Type that or less.`;
    return { ok: false, problem: { kind: 'balance', text } };
  }
  return { ok: true, amountRaw: parsed.raw };
}
