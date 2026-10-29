import { freshOrderWithinReview } from '../../../lib/solana/swap-press.ts';
import type { OrderBody, QuoteBody } from './engine.ts';
import { formatBps, formatImpact, formatRoute, formatUnits, type ImpactLevel } from './format.ts';

/**
 * The figures on the trade card, read from the engine's quote or order and never computed here: what you get, the
 * least you get, Ryntra's fee, the route and the price impact. The fee is the engine's own policy for this coin; the
 * city only writes it down.
 */

type Priced = QuoteBody['order'] | OrderBody['order'];

export type Figures = Readonly<{
  /** What the swap is expected to bring, short: 276.9 */
  get: string;
  /** The least the chain lets it bring, rounded down: 272.7 */
  minimum: string;
  /** Ryntra's fee on this swap: 1%, 0.5%, 0.1% — or null when the engine takes none on it. */
  fee: string | null;
  route: string;
  impact: string;
  impactLevel: ImpactLevel;
  /** The slippage the minimum allows: 0.5% */
  slippage: string;
  /** Solana's network fee for the transaction, in SOL, when the engine states it. */
  networkSol: string | null;
  /** A one-time deposit for a new token account, in SOL; only an order knows it. */
  depositSol: string | null;
}>;

const LAMPORTS = /^\d{1,20}$/;

function lamports(...values: readonly (string | null | undefined)[]): bigint | null {
  let sum = 0n;
  for (const value of values) {
    if (typeof value !== 'string' || !LAMPORTS.test(value)) return null;
    sum += BigInt(value);
  }
  return sum;
}

export function figuresOf(priced: Priced, outputDecimals: number, kind: 'quote' | 'order'): Figures {
  const fee = priced.ryntraFee;
  const network = lamports(priced.signatureFeeLamports, priced.priorityFeeLamports);
  const deposit = kind === 'order' ? lamports(priced.rentFeeLamports) : null;
  const impact = formatImpact(priced.priceImpactPct);
  return {
    get: formatUnits(priced.outAmountRaw, outputDecimals),
    minimum: formatUnits(priced.minReceivedRaw, outputDecimals, 'down'),
    fee: fee && fee.basisPoints > 0 ? formatBps(fee.basisPoints) : null,
    route: formatRoute(priced.route),
    impact: impact.text,
    impactLevel: impact.level,
    slippage: formatBps(priced.slippageBps),
    networkSol: network !== null && network > 0n ? formatUnits(network.toString(), 9) : null,
    depositSol: deposit !== null && deposit > 0n ? formatUnits(deposit.toString(), 9) : null,
  };
}

/** The decimals of a mint as the engine read them from the chain, or null when it did not say. */
export function decimalsOf(body: Readonly<{ decimals: Readonly<Record<string, number>> }>, mint: string): number | null {
  const value = body.decimals?.[mint];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 18 ? value : null;
}

/** The warnings the engine's swap policy raised over an order: things a person reads before signing. */
export function orderWarnings(order: OrderBody): readonly string[] {
  return order.policy.verdict.findings.filter((finding) => finding.outcome === 'REVIEW').map((finding) => finding.rule);
}

/** What each warning says on the card, in one line. */
export function warningLine(rule: string, order: OrderBody): string {
  if (rule === 'OUTPUT_ASSET_REVIEWED') return 'This token needs extra care. Check it before you sign.';
  if (rule === 'SLIPPAGE_BOUNDED') {
    const quoted = BigInt(order.order.outAmountRaw);
    const least = BigInt(order.order.minReceivedRaw);
    const implied = quoted > 0n ? Number(((quoted - least) * 10_000n) / quoted) : 0;
    return Math.max(order.order.slippageBps, implied) > 300 ? 'The price may move more than 3% before it lands.' : 'Check the least you get.';
  }
  if (rule === 'PRICE_IMPACT_DISCLOSED') return 'This size moves the price.';
  if (rule === 'VALUE_DISCLOSED') return 'No dollar value for this swap right now.';
  return 'Check this swap before you sign.';
}

/**
 * May the wallet open on this order in the same tap that asked for it? Only when it is the same swap the card showed
 * and no worse on anything the card said: the least you get no lower, Ryntra's fee and the venue's fees no higher,
 * Solana's fee within a small slack, and no warning at all. A new token account's deposit is not part of the price the
 * card showed (a quote cannot know the wallet), so it is shown on the order and never counted as a worse figure.
 */
export function orderMatchesQuote(quote: QuoteBody['order'], order: OrderBody): boolean {
  const o = order.order;
  return freshOrderWithinReview(
    { ...quote, rentFeeLamports: o.rentFeeLamports },
    o,
    { reviewed: [], fresh: orderWarnings(order) },
  );
}

/** A second order for a reviewed one: the same swap, no worse, no warning the reviewed one did not carry. */
export function orderMatchesReview(reviewed: OrderBody, fresh: OrderBody): boolean {
  return freshOrderWithinReview(reviewed.order, fresh.order, { reviewed: orderWarnings(reviewed), fresh: orderWarnings(fresh) });
}
