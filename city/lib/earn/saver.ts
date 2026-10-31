import { rawFromText } from '../../../lib/earn/model.ts';
import type { OrderBody, QuoteBody } from '../trade/engine.ts';
import { figuresOf } from '../trade/figures.ts';
import { lamportsOf, type SolRate } from './lst.ts';

/**
 * The SOL Saver's one line before the signature (CITY-94): SOL in, an LST out, through the very swap route the city's
 * trade card uses (`/api/solana/swap/*`, the engine's fee policy — no new route, no new fee). Every figure here is the
 * engine's quote or order, or the LST's worth read from its pool; this file only puts them side by side in SOL.
 *
 * - the swap's fee — Ryntra's, as the engine's policy sets it for this pair;
 * - the least that arrives, and what it is worth in SOL;
 * - the network's cost — the signature and priority fees, and the deposit for a new token account (rent);
 * - the LST's own costs — the pool's share of staking rewards, and the spread to swap back to SOL right now;
 * - the main risk — an LST can trade below its worth in SOL when the market for it thins.
 */

export const SAVER_DECIMALS = 9;

/** An amount of SOL as typed («1.5», «0,25») in lamports; null for anything else or nothing. */
export function lamportsFromText(text: string): bigint | null {
  const raw = rawFromText(text, SAVER_DECIMALS);
  return raw !== null && raw > 0n ? raw : null;
}

/** How much of the SOL in is lost on the way in: 1 − (the LST out, valued in SOL) / (the SOL in), per cent. */
export function entryCostPct(inLamports: bigint, outRaw: bigint, rate: SolRate | null): number | null {
  const worth = lamportsOf(outRaw, rate);
  if (worth === null || inLamports <= 0n) return null;
  return (1 - Number(worth) / Number(inLamports)) * 100;
}

/** How much a swap straight back would lose: 1 − (SOL a reverse quote gives) / (the LST's worth in SOL), per cent. */
export function exitSpreadPct(lstRaw: bigint, solOutLamports: bigint, rate: SolRate | null): number | null {
  const worth = lamportsOf(lstRaw, rate);
  if (worth === null || worth <= 0n) return null;
  return (1 - Number(solOutLamports) / Number(worth)) * 100;
}

export type SaverLine = Readonly<{
  /** Ryntra's swap fee as the engine states it: «0.1%»; null when the engine takes none. */
  fee: string | null;
  /** The least LST that arrives, as text, and its worth in SOL. */
  minimum: string;
  minimumLamports: bigint | null;
  /** What is expected to arrive, as text, and its worth in SOL. */
  expected: string;
  expectedLamports: bigint | null;
  /** The network's fee for the transaction, SOL text; null when not stated. */
  networkSol: string | null;
  /** A one-time deposit for the LST's token account, SOL text; null when there is none (only an order knows). */
  rentSol: string | null;
  /** The network's fee and the account deposit together, lamports; null when the engine stated neither. */
  costLamports: bigint | null;
  /** The engine's route: «Sanctum Infinity», «Jupiter». */
  route: string;
  impact: string;
}>;

const LAMPORTS = /^\d{1,20}$/;

/** Solana's fees for the transaction and, on an order, the new token account's deposit, lamports. */
export function costOf(priced: Pick<QuoteBody['order'], 'signatureFeeLamports' | 'priorityFeeLamports'> & Partial<Pick<OrderBody['order'], 'rentFeeLamports'>>, kind: 'quote' | 'order'): bigint | null {
  const parts = [priced.signatureFeeLamports, priced.priorityFeeLamports, ...(kind === 'order' ? [priced.rentFeeLamports] : [])];
  let sum = 0n;
  let read = false;
  for (const part of parts) {
    if (typeof part !== 'string' || !LAMPORTS.test(part)) continue;
    sum += BigInt(part);
    read = true;
  }
  return read && sum > 0n ? sum : null;
}

/** The line from the engine's quote (before a wallet) or order (the exact transaction to sign). */
export function saverLine(priced: QuoteBody['order'] | OrderBody['order'], kind: 'quote' | 'order', rate: SolRate | null): SaverLine {
  const figures = figuresOf(priced, SAVER_DECIMALS, kind);
  const least = /^\d+$/.test(priced.minReceivedRaw) ? BigInt(priced.minReceivedRaw) : null;
  const out = /^\d+$/.test(priced.outAmountRaw) ? BigInt(priced.outAmountRaw) : null;
  return {
    fee: figures.fee,
    minimum: figures.minimum,
    minimumLamports: least === null ? null : lamportsOf(least, rate),
    expected: figures.get,
    expectedLamports: out === null ? null : lamportsOf(out, rate),
    networkSol: figures.networkSol,
    rentSol: figures.depositSol,
    costLamports: costOf(priced, kind),
    route: figures.route,
    impact: figures.impact,
  };
}

/** A year at the last epoch's rate, lamports, for reading beside the rate: never a promise, said so in its «i». */
export function yearAtRate(lamports: bigint | null, apyPct: number | null): bigint | null {
  if (lamports === null || apyPct === null || !Number.isFinite(apyPct)) return null;
  return BigInt(Math.round(Number(lamports) * (apyPct / 100)));
}
