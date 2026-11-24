/**
 * The ticket's own rules, without React: what its one button says and does, when «Try again» stands, and when a press
 * may open the wallet. The price, the route, the fee and the signature are the trade card's logic as it is
 * (`city/lib/trade/store.ts`); these rules only decide what the screen shows over it.
 *
 * Pure: the tests hold them as they are written.
 */

import { typedPrice } from '../../lib/solana/limits/model.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';

/** Where a trade is, as the trade card's store says it. */
export type TicketPhase = 'idle' | 'preparing' | 'wallet' | 'sending' | 'checking' | 'done' | 'failed' | 'unknown';

export type ActionInput = Readonly<{
  phase: TicketPhase;
  side: 'buy' | 'sell';
  connected: boolean;
  /** A wallet is being connected by a tap. */
  connecting: boolean;
  /** What is wrong with the amount in the field: `balance` — more than can be spent; `other` — not an amount. */
  problem: 'balance' | 'other' | null;
  /** The field holds an amount the engine can price. */
  hasAmount: boolean;
  /** The wallet's balance is read and there is nothing of the spent coin to spend. */
  empty: boolean;
  /** The engine's price for the amount is on screen. */
  priced: boolean;
  /** The exact order the wallet would sign is on screen. */
  exact: boolean;
  /** The screen has somewhere to send a person with nothing to buy with. */
  canTopUp: boolean;
  /**
   * The order being built was asked by the card itself, while the person reads the price — not by a press. Absent:
   * false.
   */
  auto?: boolean;
}>;

export type ActionLabel = 'verb' | 'connect' | 'connecting' | 'building' | 'wallet' | 'sending' | 'checking' | 'short' | 'nothing' | 'topUp';

export type ActionView = Readonly<{
  label: ActionLabel;
  /** `press` — the trade card's one step (build the order, then the wallet); `topUp` — the way to get funds. */
  does: 'press' | 'topUp' | 'none';
  busy: boolean;
}>;

const wait = (label: ActionLabel): ActionView => ({ label, does: 'none', busy: true });
const rest = (label: ActionLabel): ActionView => ({ label, does: 'none', busy: false });
const go = (label: ActionLabel, does: 'press' | 'topUp' = 'press'): ActionView => ({ label, does, busy: false });

/**
 * The ticket's one amber button. It is the trade's verb — «Buy SOL» — whenever a press can do it, and while it cannot
 * it says the one thing missing. It is never «Try again»: a price that did not come is asked again by a quiet control
 * of its own (`retryShown`), so a tap meant for that control cannot land on the button that opens the wallet.
 */
export function actionOf(input: ActionInput): ActionView {
  // The card building its first order while the price is read is no wait of the person's: the button reads on as if
  // idle, and a press then waits for that order and shows it (`useTrade.press`). Renewing bytes already on screen, or
  // an order a press asked for, is a wait.
  if (input.phase === 'preparing' && !(input.auto && !input.exact)) return wait('building');
  if (input.phase === 'wallet') return wait('wallet');
  if (input.phase === 'sending') return wait('sending');
  if (input.phase === 'checking') return wait('checking');
  if (input.connecting) return wait('connecting');
  if (input.connected && input.side === 'buy' && input.empty) return input.canTopUp ? go('topUp', 'topUp') : rest('short');
  if (input.problem === 'balance') return rest('short');
  if (input.problem) return rest('verb');
  if (!input.connected) return go('connect');
  if (!input.hasAmount) return rest(input.empty ? (input.side === 'sell' ? 'nothing' : 'short') : 'verb');
  // No price and no order on screen: nothing a press could agree to.
  if (!input.priced && !input.exact) return rest('verb');
  return go('verb');
}

/**
 * Whether «Try again» stands in the fee's place: the engine's price did not come, asking again can help, and no order
 * is on screen. It only reads the price again.
 */
export function retryShown(input: Readonly<{ quoteFailed: boolean; retryable: boolean; exact: boolean; phase: TicketPhase }>): boolean {
  return input.quoteFailed && input.retryable && !input.exact && input.phase === 'idle';
}

/** After a price that did not come, the order's figures stand this long before a press may open the wallet. */
export const READ_BEFORE_PRESS_MS = 1_200;

/**
 * What the ticket remembers of a price that did not come: `failed` until the exact order stands on screen again, and
 * `since` — when it did.
 */
export type Guard = Readonly<{ failed: boolean; since: number | null }>;

export const NO_GUARD: Guard = { failed: false, since: null };

/** The guard after what the screen shows now. */
export function guardNext(guard: Guard, seen: Readonly<{ quoteFailed: boolean; exact: boolean }>, now: number): Guard {
  if (seen.quoteFailed) return guard.failed && guard.since === null ? guard : { failed: true, since: null };
  if (guard.failed && seen.exact) return { failed: false, since: now };
  return guard;
}

/**
 * Whether a press is held back: the order's figures came after a failed price and have not stood long enough to be
 * read. A held press does nothing — the next one, a moment later, is the person's own.
 */
export function pressHeld(guard: Guard, now: number): boolean {
  return guard.since !== null && now - guard.since < READ_BEFORE_PRESS_MS;
}

/**
 * Whether the trade card may be given to another coin: it is shut, or it rests on its fields. A trade under way, its
 * result, or a limit's signature keep the card on their own coin until the person lets them go.
 */
export function ticketFree(card: Readonly<{ open: boolean; phase: TicketPhase; held: boolean }>): boolean {
  return !card.open || (card.phase === 'idle' && !card.held);
}

/* ── the person's own quick sums ─────────────────────────────────────────────────────────────────────────────────── */

/** What a buy's quick sums are written in: SOL, or dollars (USDC, USDT). */
export type QuickPay = 'sol' | 'usd';

/** The four quick sums of a buy, per what pays, as the person reads them: «0.5», «100». */
export type QuickSums = Readonly<Record<QuickPay, readonly string[]>>;

/** How many quick buttons stand in a row — and how many keys (1–4) reach them. */
export const QUICK_SLOTS = 4;

/** The sums until the person changes them: tenths of SOL to five, ten to five hundred dollars. */
export const QUICK_START: QuickSums = { sol: ['0.1', '0.5', '1', '5'], usd: ['10', '50', '100', '500'] };

/** Where this browser keeps the person's own sums, and their take-profit and stop. */
export const QUICK_KEY = 'ryntra.terminal.quick';

const QUICK_PLACES: Readonly<Record<QuickPay, number>> = { sol: 4, usd: 2 };
const QUICK_MOST: Readonly<Record<QuickPay, number>> = { sol: 10_000, usd: 1_000_000 };

/**
 * One quick sum the row can keep, written plainly («0.25», «100»), or null: a positive decimal — a comma read as the
 * point — of at most four places in SOL and two in dollars, at most 10,000 SOL or $1,000,000.
 */
export function cleanQuickSum(text: string, pay: QuickPay): string | null {
  const typed = text.trim().replace(',', '.');
  const match = /^(\d{1,7})?(?:\.(\d+))?$/.exec(typed);
  if (!match || (!match[1] && !match[2])) return null;
  const places = match[2] ?? '';
  if (places.length > QUICK_PLACES[pay]) return null;
  const value = Number(`${match[1] ?? '0'}.${places || '0'}`);
  if (!(value > 0) || value > QUICK_MOST[pay]) return null;
  const whole = String(Number(match[1] ?? '0'));
  const part = places.replace(/0+$/, '');
  return part ? `${whole}.${part}` : whole;
}

/** A row of four: each sum clean, all different, smallest first; anything else is not a row. */
function quickRow(value: unknown, pay: QuickPay): string[] | null {
  if (!Array.isArray(value) || value.length !== QUICK_SLOTS) return null;
  const clean = value.map((item) => (typeof item === 'string' || typeof item === 'number' ? cleanQuickSum(String(item), pay) : null));
  if (clean.some((item) => item === null)) return null;
  const sorted = (clean as string[]).sort((a, b) => Number(a) - Number(b));
  return new Set(sorted.map(Number)).size === QUICK_SLOTS ? sorted : null;
}

/* ── take-profit and stop, one line at the buy ───────────────────────────────────────────────────────────────────── */

/** The take-profit and the stop the person keeps, per cent from the price the buy paid: «+50 % · −20 %». */
export type ProtectSet = Readonly<{ take: number; stop: number }>;

export const PROTECT_START: ProtectSet = { take: 50, stop: 20 };
/** A take-profit is 1–1000 % above the entry; a stop 1–90 % below it. */
export const TAKE_RANGE = [1, 1000] as const;
export const STOP_RANGE = [1, 90] as const;

/** A whole per cent within its range, or null. */
export function cleanPct(value: unknown, range: readonly [number, number]): number | null {
  const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= range[0] && n <= range[1] ? n : null;
}

/** What this browser keeps of the ticket: the buy's quick sums and the take-profit and stop. */
export type QuickKept = Readonly<{ sums: QuickSums; protect: ProtectSet }>;

export const QUICK_KEPT_START: QuickKept = { sums: QUICK_START, protect: PROTECT_START };

/** What the browser kept, read whole: a part that is not a clean row or a clean per cent falls back to its start. */
export function readQuick(text: string | null): QuickKept {
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const kept = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sums = kept.sums && typeof kept.sums === 'object' ? (kept.sums as Record<string, unknown>) : {};
  const protect = kept.protect && typeof kept.protect === 'object' ? (kept.protect as Record<string, unknown>) : {};
  return {
    sums: { sol: quickRow(sums.sol, 'sol') ?? QUICK_START.sol, usd: quickRow(sums.usd, 'usd') ?? QUICK_START.usd },
    protect: { take: cleanPct(protect.take, TAKE_RANGE) ?? PROTECT_START.take, stop: cleanPct(protect.stop, STOP_RANGE) ?? PROTECT_START.stop },
  };
}

export function writeQuick(kept: QuickKept): string {
  return JSON.stringify({ v: 1, sums: kept.sums, protect: kept.protect });
}

/**
 * A row the person edited, four typed sums: kept clean and smallest first, or null with the first sum that cannot be
 * one (`bad`, its place in what was typed) — two equal sums count the second as the bad one.
 */
export function editQuick(typed: readonly string[], pay: QuickPay): Readonly<{ ok: true; row: string[] }> | Readonly<{ ok: false; bad: number }> {
  const seen = new Set<number>();
  const row: string[] = [];
  for (let i = 0; i < QUICK_SLOTS; i += 1) {
    const sum = cleanQuickSum(typed[i] ?? '', pay);
    if (sum === null || seen.has(Number(sum))) return { ok: false, bad: i };
    seen.add(Number(sum));
    row.push(sum);
  }
  return { ok: true, row: row.sort((a, b) => Number(a) - Number(b)) };
}

/** One quick button's deed: write an amount in what pays, or take a share of what can be spent (a sale's, a coin's). */
export type QuickAction =
  | Readonly<{ slot: number; kind: 'amount'; amount: string; pay: QuickPay }>
  | Readonly<{ slot: number; kind: 'share'; share: number }>;

export type QuickInput = Readonly<{
  side: 'buy' | 'sell';
  /** What a buy pays with, when it is SOL or dollars; null — another coin of the wallet, which has shares only. */
  pay: QuickPay | null;
  sums: QuickSums;
  /** The shares a sale takes (the person's own sale chips) — and a buy paid in another coin. */
  shares: readonly number[];
}>;

/**
 * The set of quick sums as deeds, in the row's order, slot 1 first: a buy paid in SOL or dollars writes its sums; a sale,
 * or a buy paid in another coin, takes its shares. Pure — the keys 1–4 and the buttons read the same list.
 */
export function quickActions(input: QuickInput): QuickAction[] {
  if (input.side === 'buy' && input.pay) {
    const pay = input.pay;
    return input.sums[pay].slice(0, QUICK_SLOTS).map((amount, i) => ({ slot: i + 1, kind: 'amount', amount, pay }));
  }
  return input.shares.slice(0, QUICK_SLOTS).map((share, i) => ({ slot: i + 1, kind: 'share', share }));
}

/** The deed of quick button `slot` (1–4, as the keys 1–4 name them), or null where the row has none. */
export function quickActionAt(input: QuickInput, slot: number): QuickAction | null {
  return quickActions(input).find((action) => action.slot === slot) ?? null;
}

/* ── take-profit and stop prices from the buy that landed ─────────────────────────────────────────────────────────── */

/** Raw units as a number of whole units. */
const units = (raw: string, decimals: number): number | null => (/^\d+$/.test(raw) && Number.isInteger(decimals) && decimals >= 0 ? Number(raw) / 10 ** decimals : null);

/**
 * What the buy paid per coin, in what paid: what left over what came, as the chain read them back — fees inside.
 * Null when either side is not known or is nothing.
 */
export function entryOf(input: Readonly<{ paidRaw: string; paidDecimals: number; gotRaw: string; gotDecimals: number }>): number | null {
  const paid = units(input.paidRaw, input.paidDecimals);
  const got = units(input.gotRaw, input.gotDecimals);
  if (paid === null || got === null || !(paid > 0) || !(got > 0)) return null;
  const entry = paid / got;
  return Number.isFinite(entry) && entry > 0 ? entry : null;
}

/**
 * The take-profit's and the stop's prices from the entry, in what paid, written as the engine takes a price: the entry
 * `take` per cent up and `stop` per cent down. Null when the entry is not a price.
 */
export function protectPrices(entry: number, set: ProtectSet): Readonly<{ take: string; stop: string }> | null {
  if (!(entry > 0) || !Number.isFinite(entry)) return null;
  const take = typedPrice(entry * (1 + set.take / 100));
  const stop = typedPrice(entry * (1 - set.stop / 100));
  return take && stop ? { take, stop } : null;
}

/* ── a limit by market cap ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The limit's price for a market cap: the cap in dollars over the supply it is counted on, in what pays (its dollar
 * price). Null when any of them is not a positive figure.
 */
export function capToPrice(capUsd: number, supply: number | null, quoteUsd: number | null): number | null {
  if (!(capUsd > 0) || supply === null || !(supply > 0) || quoteUsd === null || !(quoteUsd > 0)) return null;
  const price = capUsd / supply / quoteUsd;
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** The market cap a limit's price stands at, in dollars: the price in dollars times the supply. */
export function priceToCap(price: number, supply: number | null, quoteUsd: number | null): number | null {
  if (!(price > 0) || supply === null || !(supply > 0) || quoteUsd === null || !(quoteUsd > 0)) return null;
  const cap = price * quoteUsd * supply;
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** A market cap as the field takes it: whole dollars, no grouping. */
export function capWritten(capUsd: number): string {
  return capUsd > 0 && Number.isFinite(capUsd) ? String(Math.round(capUsd)) : '';
}

/**
 * A market cap as the field's hint shows it: whole dollars with the thousands marked the language's way —
 * «2,032,800,000», «2 032 800 000» (QA 20.11: ten digits in a row read as nothing).
 */
export function capHint(capUsd: number, lang: Lang): string {
  const whole = capWritten(capUsd);
  return whole ? digits(whole.replace(/\B(?=(\d{3})+(?!\d))/g, ','), lang) : '';
}

/**
 * The cap as the person typed it, the thousands marks the hint shows dropped: a comma in English (its point stays the
 * decimal one); in Ukrainian the field already drops the spaces, and its comma is the decimal one.
 */
export function capFromTyped(text: string, lang: Lang): string {
  return lang === 'en' ? text.replace(/,/g, '') : text.replace(/,/g, '.');
}

/** A market cap said short: «$1.25M», «$840K», «$2.1B». */
export function capShort(capUsd: number): string {
  if (!(capUsd > 0) || !Number.isFinite(capUsd)) return '';
  const steps: readonly [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, mark] of steps) {
    if (capUsd >= size) {
      const n = capUsd / size;
      return `$${String(Number(n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)))}${mark}`;
    }
  }
  return `$${String(Number(capUsd.toFixed(2)))}`;
}

/* ── bought · sold · holding · result, for this coin ─────────────────────────────────────────────────────────────── */

/** The wallet's record of one coin, as «Стеження за гаманцями» reads it from the chain (`lib/wallet-watch`). */
export type StandRow = Readonly<{
  buys: number;
  sells: number;
  /** Whole coins bought and sold. */
  bought: number;
  sold: number;
  /** What the buys paid and the sales brought, SOL; null — no leg had a price. */
  spentSol: number | null;
  receivedSol: number | null;
  /** Some leg had no price or no known cost. */
  partial: boolean;
}>;

export type StandInput = Readonly<{
  row: StandRow | null;
  /** The read is whole for the coin: no transactions left unread between reads. */
  whole: boolean;
  /** A trade of the coin that no price was read for (a swap for another token, or bought by another wallet). */
  unpriced: boolean;
  /** Whole coins the wallet holds now; null — not read. */
  held: number | null;
  /** The coin's price now in SOL; null — not known. */
  priceSol: number | null;
}>;

export type CoinStand = Readonly<{ boughtSol: number; soldSol: number; holdingSol: number; resultSol: number; resultPct: number }>;

/** How far what is held may stand from what was bought less what was sold before the record is not this wallet's whole story. */
const HELD_SLACK = 0.01;

/**
 * Bought · sold · holding · result for the coin, in SOL — only when the record says it whole: bought here, every leg
 * priced, nothing left unread, and what the wallet holds is what was bought less what was sold (no coins came or left
 * another way). The result is what the sales brought and what is held is worth now, less what the buys paid. Null —
 * the strip is not drawn; it never stands half known.
 */
export function standOf(input: StandInput): CoinStand | null {
  const { row, held, priceSol } = input;
  if (!row || row.buys < 1 || row.partial || input.unpriced || !input.whole) return null;
  if (row.spentSol === null || !(row.spentSol > 0)) return null;
  if (row.sells > 0 && row.receivedSol === null) return null;
  if (held === null || !(held >= 0)) return null;
  const left = row.bought - row.sold;
  if (Math.abs(held - left) > Math.max(left, held) * HELD_SLACK + 1e-9) return null;
  if (held > 0 && (priceSol === null || !(priceSol > 0))) return null;
  const soldSol = row.sells > 0 ? (row.receivedSol ?? 0) : 0;
  const holdingSol = held > 0 ? held * (priceSol as number) : 0;
  const resultSol = soldSol + holdingSol - row.spentSol;
  if (![soldSol, holdingSol, resultSol].every(Number.isFinite)) return null;
  return { boughtSol: row.spentSol, soldSol, holdingSol, resultSol, resultPct: (resultSol / row.spentSol) * 100 };
}
