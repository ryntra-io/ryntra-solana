/**
 * Where the coins of a stock buy or of income are, read from the chain — never from what the tab remembers. The same
 * rule as the private swap (`../swap/recover.ts`): a signed transaction is never sent a second time; a step still able
 * to land is waited for; once its blockhash has expired it never lands, and a break leaves coins only on the person's
 * own wallet, with one action — «Return to private balance».
 *
 * Buy (`one` — one transaction; `pack` — out, then the route):
 * - out not landed, and it can no longer land → nothing moved, the coins are still in the private balance;
 * - out landed, the route not → the coin paid with sits on the person's wallet: one action back;
 * - the route landed → done: the stock is on the person's wallet (the ring does not take it).
 *
 * Income (`one` — claim and deposit together; `pack` — the claim's transactions, then the deposit):
 * - no claim landed and none can → nothing moved, the income is still in the pool;
 * - a claim landed, the deposit not → the income sits on the person's wallet: one action back;
 * - the deposit landed → done: the income is in the private balance.
 */

import { SOL_FEE_KEEP, onChainOf, type OnChain, type StepRead } from '../swap/recover.ts';

export { SOL_FEE_KEEP, onChainOf, type OnChain, type StepRead };

const gone = (step: StepRead | undefined, expired: boolean) => step?.status === 'failed' || (step?.status === 'missing' && expired);
const waiting = (step: StepRead | undefined, expired: boolean) => step === undefined || (step.status === 'missing' && !expired);

/** What the wallet holds of a coin, less what SOL keeps for the network's fees, capped at what the flow moved. */
function capped(held: bigint, most: bigint, isSol: boolean): bigint {
  const usable = isSol ? (held > SOL_FEE_KEEP ? held - SOL_FEE_KEEP : 0n) : held;
  return usable < most ? usable : most;
}

/* ── buy ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type BuyFacts = Readonly<{
  payMint: string;
  stockMint: string;
  /** Paid out of the ring into the wallet: the route's input. */
  outAmount: bigint;
  /** The route's minimum in the stock. */
  minStock: bigint;
  /** The coin paid with is SOL: the wallet keeps some for the network's fees. */
  paySol: boolean;
}>;

export type BuyRead = Readonly<{
  kind: 'one' | 'pack';
  /** For `one`: only `out` (the one transaction). For `pack`: out, then the route. */
  out: StepRead;
  route?: StepRead;
  expired: boolean;
  /** The person's own wallet now in the coin paid with (SOL in lamports). */
  walletPay: bigint;
  /** What the route paid the wallet in the stock, read from its own transaction; null until landed or unreadable. */
  received: bigint | null;
}>;

export type BuyWhere =
  /** Still landing: wait, read again. */
  | Readonly<{ place: 'landing' }>
  /** Nothing left the private balance. */
  | Readonly<{ place: 'private' }>
  /** The coin paid with is on the person's own wallet after a break: one action — back into the private balance. */
  | Readonly<{ place: 'wallet'; mint: string; amount: bigint }>
  /** Done: the stock is on the person's wallet. `received` — from the chain; null when unreadable (at least `minStock`). */
  | Readonly<{ place: 'bought'; received: bigint | null }>;

export function whereAfterBuy(read: BuyRead, facts: BuyFacts): BuyWhere {
  const bought = (): BuyWhere => ({ place: 'bought', received: read.received });
  if (read.kind === 'one') {
    if (read.out.status === 'landed') return bought();
    if (gone(read.out, read.expired)) return { place: 'private' };
    return { place: 'landing' };
  }
  if (waiting(read.out, read.expired)) return { place: 'landing' };
  if (gone(read.out, read.expired)) return { place: 'private' };
  if (waiting(read.route, read.expired)) return { place: 'landing' };
  if (gone(read.route, read.expired)) {
    const amount = capped(read.walletPay, facts.outAmount, facts.paySol);
    return amount > 0n ? { place: 'wallet', mint: facts.payMint, amount } : { place: 'private' };
  }
  return bought();
}

/* ── income ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type IncomeFacts = Readonly<{
  /** The coin that goes back: SOL (as the ring names it) or USDC. */
  mint: string;
  /** The deposit's amount: the claimed fees of that coin. */
  amount: bigint;
  isSol: boolean;
}>;

export type IncomeRead = Readonly<{
  kind: 'one' | 'pack';
  /** For `one`: the one transaction. For `pack`: each claim transaction, in order. */
  claims: readonly StepRead[];
  /** For `pack` only: the deposit. */
  deposit?: StepRead;
  expired: boolean;
  /** The person's own wallet now in the coin that goes back. */
  walletHeld: bigint;
}>;

export type IncomeWhere =
  | Readonly<{ place: 'landing' }>
  /** Nothing moved: the income is still in the pool. */
  | Readonly<{ place: 'pool' }>
  /** The income is on the person's own wallet after a break: one action — back into the private balance. */
  | Readonly<{ place: 'wallet'; mint: string; amount: bigint }>
  /** Done: the income is in the private balance. */
  | Readonly<{ place: 'private' }>;

export function whereAfterIncome(read: IncomeRead, facts: IncomeFacts): IncomeWhere {
  if (read.kind === 'one') {
    const one = read.claims[0];
    if (one?.status === 'landed') return { place: 'private' };
    if (gone(one, read.expired)) return { place: 'pool' };
    return { place: 'landing' };
  }
  const landed = read.claims.filter((c) => c.status === 'landed').length;
  if (read.claims.some((c) => waiting(c, read.expired))) return { place: 'landing' };
  if (landed === 0) return { place: 'pool' };
  // A claim landed: the income is on the wallet until the deposit takes it. The pack stops at the first step that does
  // not land, so a deposit after a failed claim was never sent.
  if (landed === read.claims.length && waiting(read.deposit, read.expired)) return { place: 'landing' };
  if (landed === read.claims.length && read.deposit?.status === 'landed') return { place: 'private' };
  const amount = capped(read.walletHeld, facts.amount, facts.isSol);
  return amount > 0n ? { place: 'wallet', mint: facts.mint, amount } : { place: 'pool' };
}

/* ── the one action ─────────────────────────────────────────────────────────────────────────────────────────────── */

export type StockNext = Readonly<{ does: 'none' }> | Readonly<{ does: 'wait' }> | Readonly<{ does: 'return'; mint: string; amount: bigint }>;

export function nextAfter(where: BuyWhere | IncomeWhere): StockNext {
  if (where.place === 'landing') return { does: 'wait' };
  if (where.place === 'wallet') return { does: 'return', mint: where.mint, amount: where.amount };
  return { does: 'none' };
}

/* ── the record a tab keeps ─────────────────────────────────────────────────────────────────────────────────────── */

/** Signatures and coins only, nothing the answer trusts: the chain is read again from them. */
export type StockRecord =
  | Readonly<{
      v: 1;
      flow: 'buy';
      kind: 'one' | 'pack';
      owner: string;
      signatures: readonly string[];
      lastValidBlockHeight: string;
      facts: Readonly<{ payMint: string; stockMint: string; outAmount: string; minStock: string; paySol: boolean }>;
    }>
  | Readonly<{
      v: 1;
      flow: 'income';
      kind: 'one' | 'pack';
      owner: string;
      signatures: readonly string[];
      lastValidBlockHeight: string;
      facts: Readonly<{ mint: string; amount: string; isSol: boolean }>;
    }>;

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT = /^\d{1,30}$/;
/** The most transactions an income pack holds: the claim's (DLMM splits a wide range) and the deposit. */
export const INCOME_MOST = 8;

/** A kept record as it was written, or null for anything that does not read as one. */
export function readStockRecord(text: string | null | undefined): StockRecord | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as Record<string, unknown> | null;
  if (!r || r.v !== 1 || (r.kind !== 'one' && r.kind !== 'pack') || (r.flow !== 'buy' && r.flow !== 'income')) return null;
  if (typeof r.owner !== 'string' || !ADDRESS.test(r.owner)) return null;
  if (!Array.isArray(r.signatures) || !r.signatures.every((s) => typeof s === 'string' && SIGNATURE.test(s))) return null;
  const count = r.signatures.length;
  if (r.kind === 'one' ? count !== 1 : r.flow === 'buy' ? count !== 2 : count < 2 || count > INCOME_MOST) return null;
  if (typeof r.lastValidBlockHeight !== 'string' || !AMOUNT.test(r.lastValidBlockHeight)) return null;
  const f = r.facts as Record<string, unknown> | undefined;
  if (!f) return null;
  const base = { v: 1 as const, kind: r.kind as 'one' | 'pack', owner: r.owner, signatures: [...(r.signatures as string[])], lastValidBlockHeight: r.lastValidBlockHeight };
  if (r.flow === 'buy') {
    if (![f.payMint, f.stockMint].every((m) => typeof m === 'string' && ADDRESS.test(m))) return null;
    if (![f.outAmount, f.minStock].every((a) => typeof a === 'string' && AMOUNT.test(a)) || typeof f.paySol !== 'boolean') return null;
    return { ...base, flow: 'buy', facts: { payMint: f.payMint as string, stockMint: f.stockMint as string, outAmount: f.outAmount as string, minStock: f.minStock as string, paySol: f.paySol } };
  }
  if (typeof f.mint !== 'string' || !ADDRESS.test(f.mint) || typeof f.amount !== 'string' || !AMOUNT.test(f.amount) || typeof f.isSol !== 'boolean') return null;
  return { ...base, flow: 'income', facts: { mint: f.mint, amount: f.amount, isSol: f.isSol } };
}

export type BuyRecord = Extract<StockRecord, { flow: 'buy' }>;
export type IncomeRecord = Extract<StockRecord, { flow: 'income' }>;

export function buyFactsOf(record: BuyRecord): BuyFacts {
  const f = record.facts;
  return { payMint: f.payMint, stockMint: f.stockMint, outAmount: BigInt(f.outAmount), minStock: BigInt(f.minStock), paySol: f.paySol };
}

export function incomeFactsOf(record: IncomeRecord): IncomeFacts {
  const f = record.facts;
  return { mint: f.mint, amount: BigInt(f.amount), isSol: f.isSol };
}
