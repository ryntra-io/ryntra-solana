import type { BuyPath, IncomePath } from '../../../lib/privacy/stocks/plan.ts';
import type { BuyWhere, IncomeWhere } from '../../../lib/privacy/stocks/recover.ts';
import type { StockFailure, StockFlowName } from '../../../lib/privacy/stocks/useStockPrivate.ts';
import type { PRIVATE_STOCK } from './words.ts';

/**
 * The one line a stock bought from the private balance (or income put back into it) says under its band,
 * decided apart from the markup: a refusal said before anything is signed, where the coins are after the press — read
 * from the chain — or a failure in the person's words. One line, never two. Pure.
 */

type Words = (typeof PRIVATE_STOCK)['en'];

export type Line = Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }>;

export type FlowState = Readonly<{
  flow: StockFlowName | null;
  path: BuyPath | IncomePath | null;
  where: BuyWhere | IncomeWhere | null;
  failure: StockFailure | null;
  returned: boolean;
}>;

/** A coin's amount and ticker as the screen writes them. */
export type Units = Readonly<{ amount: (raw: bigint, mint: string) => string; symbol: (mint: string) => string }>;

function refusalOf(flow: StockFlowName, code: string, w: Words): Line {
  if (code === 'ELSEWHERE') return { tone: 'info', text: flow === 'buy' ? w.soon : w.incomeSoon };
  if (code === 'SAME') return { tone: 'warn', text: w.same };
  if (code === 'PAY') return { tone: 'warn', text: w.pay };
  if (code === 'ISSUER') return { tone: 'warn', text: w.issuer };
  if (code === 'COIN') return { tone: 'warn', text: w.incomeCoin };
  if (code === 'ONE_PROMPT') return { tone: 'warn', text: w.onePrompt };
  return { tone: 'warn', text: w.pair };
}

function failureText(code: string, w: Words): string {
  if (code === 'WALLET_REFUSED') return w.refused;
  if (code === 'WALLET_CHANGED_MESSAGE') return w.changed;
  if (code === 'GATE_PAUSED') return w.paused;
  if (code === 'GATE_FLAGGED' || code === 'GATE_FLAGGED_TO' || code === 'GATE_BACK_ONLY') return w.flagged;
  if (code === 'GATE_UNCHECKED') return w.unchecked;
  if (code === 'NOT_REGISTERED') return w.noBalance;
  return w.failed;
}

/**
 * The line of `flow` now. `stock` — the stock's mint for a buy; `back` — the coin and amount income puts back, for its
 * «done». Another flow's state says nothing here.
 */
export function flowLine(flow: StockFlowName, state: FlowState, w: Words, units: Units, mints: Readonly<{ stock?: string; back?: Readonly<{ mint: string; amount: bigint }> | null }> = {}): Line | null {
  if (state.flow !== flow) return null;
  const { path, where, failure } = state;
  if (path?.kind === 'refuse') return refusalOf(flow, path.code, w);
  if (where?.place === 'wallet') return { tone: 'warn', text: w.inWallet(units.amount(where.amount, where.mint), units.symbol(where.mint)) };
  if (where?.place === 'landing') return { tone: 'info', text: w.landing };
  if (where?.place === 'bought') {
    const stock = mints.stock ?? '';
    return { tone: 'info', text: where.received !== null && where.received > 0n ? w.boughtAmount(units.amount(where.received, stock), units.symbol(stock)) : w.bought(units.symbol(stock)) };
  }
  if (where?.place === 'private' && flow === 'income') {
    const back = mints.back;
    return { tone: 'info', text: back ? w.incomeDone(units.amount(back.amount, back.mint), units.symbol(back.mint)) : w.returned };
  }
  if (where?.place === 'private' || where?.place === 'pool') return { tone: 'info', text: where.place === 'pool' ? w.incomeNothing : w.nothing };
  if (state.returned) return { tone: 'info', text: w.returned };
  if (failure) return { tone: 'error', text: failureText(failure.code, w) };
  return null;
}

/** The amber button's word while a flow runs; null — the ticket's own word. */
export function stageLabel(stage: string | null, seconds: number, w: Words): string | null {
  if (!stage) return null;
  if (stage === 'proving') return w.proving(`${seconds} s`);
  if (stage === 'checking' || stage === 'signing' || stage === 'sending' || stage === 'reading' || stage === 'returning') return w[stage];
  return null;
}

/** An amount as the engine writes it: base units as a decimal string. */
type Units_ = Readonly<{ units: string }>;

/** The engine's Review of a claim or a leave, as far as income needs it (`lib/liquidity/studio/actions.ts`). */
export type ReviewLike = Readonly<{
  transactions: readonly Readonly<{ wireBase64: string; presigned: readonly string[] }>[];
  preview: Readonly<{ action: string; claimed?: Readonly<{ x: Units_; y: Units_ }>; feesClaimed?: Readonly<{ x: Units_; y: Units_ }> }>;
}>;

const DIGITS = /^\d{1,30}$/;
const units = (value: Units_ | undefined): bigint => (value && DIGITS.test(value.units) ? BigInt(value.units) : 0n);

/**
 * What a claim (its `claimed`) or a leave (its `feesClaimed`) pays as income, with the Review's own transactions — the
 * ask of `incomeToPrivate`. Null for an add, or a Review that names no fees.
 */
export function incomeClaimOf(review: ReviewLike | null, xMint: string, yMint: string, chain: string) {
  if (!review) return null;
  const fees = review.preview.action === 'claim' ? review.preview.claimed : review.preview.action === 'remove' ? review.preview.feesClaimed : undefined;
  if (!fees || review.transactions.length === 0) return null;
  return {
    transactions: review.transactions.map((tx) => ({ wireBase64: tx.wireBase64, presigned: [...tx.presigned] })),
    shown: { x: { mint: xMint, amount: units(fees.x) }, y: { mint: yMint, amount: units(fees.y) } },
    chain,
  };
}
