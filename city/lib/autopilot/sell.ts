import { create } from 'zustand';
import { SALE_SHARES, type SaleShare } from '../../../lib/mandate/sale.ts';
import type { MandateRecord } from '../bots/mandate.ts';

/**
 * Selling what the agent bought, from the tower's window (CITY-187): where the person's agent holds this tower's coin,
 * one press sells a share of it — 25, 50 or all. Before the press the window shows what she gets at least and Ryntra's
 * fee, each in one line; the rest is behind «i». The press is one signature of hers (her coin into her own vault under a
 * sale's mandate), then the agent sells at once and the window says the receipt in one line.
 *
 * The figures are the engine's (`POST /api/bots/mandate/sell`): nothing is priced here. The signing is `sell-sign.ts`,
 * loaded on the press — the window's first frame carries no transaction code.
 */

export { SALE_SHARES, type SaleShare };

/** The engine's figures of a sale (`lib/mandate/sale.server.ts` `SaleFigures`). */
export type SaleFigures = Readonly<{
  coin: string;
  decimals: number;
  heldRaw: string;
  amountRaw: string;
  quoteRaw: string;
  floorRaw: string;
  feeBps: number;
  feeRaw: string;
  feeSolRaw: string;
}>;

export type SaleReceipt = Readonly<{ policy: string; status: 'review' | 'signed' | 'sold' | 'failed'; signature: string | null; soldRaw: string; receivedRaw: string | null; reason: string | null }>;

/** A review the engine answered: the figures, the sale's mandate, her unsigned transaction and when it was built. */
export type SaleQuote = Readonly<{ share: SaleShare; figures: SaleFigures; record: MandateRecord; transactions: readonly string[]; at: number }>;

export type SellPhase = 'idle' | 'pricing' | 'signing' | 'selling' | 'done' | 'backing';
/** `nothing` — the engine says there is nothing of the agent's to sell here (a wallet that sent it away): the block steps aside. */
export type SellNote = 'walletNo' | 'refused' | 'unreachable' | 'returned' | 'nothing' | null;

const DIGITS = /^\d{1,30}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const isSaleFigures = (value: unknown): value is SaleFigures => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.coin === 'string' &&
    ADDRESS.test(v.coin) &&
    typeof v.decimals === 'number' &&
    typeof v.feeBps === 'number' &&
    (['heldRaw', 'amountRaw', 'quoteRaw', 'floorRaw', 'feeRaw', 'feeSolRaw'] as const).every((key) => typeof v[key] === 'string' && DIGITS.test(v[key] as string))
  );
};

export const isSaleReceipt = (value: unknown): value is SaleReceipt => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.policy === 'string' && ['review', 'signed', 'sold', 'failed'].includes(v.status as string) && typeof v.soldRaw === 'string';
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** The engine's review of a share; null when it does not answer, the reason when it refuses. */
export async function readSaleQuote(
  who: Readonly<{ owner: string; policy: string }>,
  share: SaleShare,
  fetcher: Fetcher = (url, init) => fetch(url, init),
  now: () => number = Date.now,
): Promise<SaleQuote | Readonly<{ refused: string; code: string }> | null> {
  try {
    const response = await fetcher('/api/bots/mandate/sell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: who.owner, policy: who.policy, share }), cache: 'no-store' });
    const value = (await response.json().catch(() => null)) as { figures?: unknown; record?: MandateRecord; transactions?: unknown; error?: { code?: string; message?: string } } | null;
    if (!response.ok) return response.status >= 500 || !value?.error ? null : { refused: value.error.message ?? 'Refused.', code: value.error.code ?? 'REFUSED' };
    if (!value || !isSaleFigures(value.figures) || !value.record || value.record.owner !== who.owner || !Array.isArray(value.transactions)) return null;
    return { share, figures: value.figures, record: value.record, transactions: value.transactions.filter((t): t is string => typeof t === 'string'), at: now() };
  } catch {
    return null;
  }
}

/** A review older than this is built again before the wallet sees it: its blockhash would be past. */
export const QUOTE_FRESH_MS = 30_000;

type SellState = {
  /** The coin the block is about. */
  mint: string | null;
  share: SaleShare;
  quote: SaleQuote | null;
  phase: SellPhase;
  receipt: SaleReceipt | null;
  note: SellNote;
  /** The coin's decimals as the engine last named them: the receipt still writes the amount once the price is gone. */
  decimals: number | null;
  /** The coin and its share pick change: what was priced for another coin is let go. */
  focus: (mint: string) => void;
  pick: (share: SaleShare) => void;
  set: (patch: Partial<Pick<SellState, 'quote' | 'phase' | 'receipt' | 'note'>>) => void;
};

export const useSell = create<SellState>((set, get) => ({
  mint: null,
  share: 100,
  quote: null,
  phase: 'idle',
  receipt: null,
  note: null,
  decimals: null,
  focus: (mint) => {
    if (get().mint === mint) return;
    set({ mint, share: 100, quote: null, phase: 'idle', receipt: null, note: null, decimals: null });
  },
  pick: (share) => {
    if (get().phase !== 'idle' && get().phase !== 'pricing') return;
    set({ share, quote: get().quote?.share === share ? get().quote : null, note: null });
  },
  set: (patch) => set(patch.quote ? { ...patch, decimals: patch.quote.figures.decimals } : patch),
}));

/** The sale's share as the chips name it. */
export const shareLabel = (share: SaleShare, all: string) => (share === 100 ? all : `${share}%`);

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __sell: useSell });
