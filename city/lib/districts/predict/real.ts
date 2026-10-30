import { wordsNow } from '../../i18n/dict.ts';
import { saidNow } from './practice.ts';
import { PREDICT_TEXT } from './words.ts';

/**
 * Real money in the window, as Ryntra Predictions states it — the managed account AGG holds for a proven Solana
 * wallet: whether live trading is open to the wallet here, the dollars it can spend, its positions with their profit
 * or loss, the Review of an order and where the order stands. Every figure is the engine's; a figure it leaves out
 * stays unknown, never zero. Pure: the store reads these from the engine's answers.
 */

export type Access = Readonly<{ state: 'off' | 'app_paper' | 'unknown' | 'open'; maxOrderUsd: number; venues: readonly string[] }>;

export type Position = Readonly<{
  key: string;
  eventId: string | null;
  title: string;
  image: string | null;
  label: string;
  shares: number;
  avg: number | null;
  price: number | null;
  value: number | null;
  pnl: number | null;
  pct: number | null;
  /** The outcome and market a sale is asked for; null when the holding spans venues and cannot be sold as one. */
  sell: Readonly<{ outcomeId: string; marketId: string }> | null;
  resolved: boolean;
}>;

/** Where an order of the window stands, in the three words a person reads: on its way, taken, or not taken. */
export type Status = 'pending' | 'accepted' | 'failed';

/** One live order as the engine keeps its record — what was asked, at what Review, and where it stands now. */
export type OrderLine = Readonly<{
  quoteId: string;
  eventId: string | null;
  marketId: string | null;
  outcomeId: string | null;
  title: string;
  label: string;
  side: 'buy' | 'sell';
  /** What left the account on a buy, or came back on a sale, as the Review priced it. */
  totalUsd: number | null;
  shares: number | null;
  price: number | null;
  state: OrderState;
  status: Status;
  at: string;
}>;

/** A win the venue marks payable now, per venue outcome. */
export type Payout = Readonly<{ outcomeId: string; title: string; label: string; valueUsd: number }>;

/** A collect the engine recorded: what was asked, and what each venue answered. */
export type Receipt = Readonly<{ id: string; at: string; totalUsd: number; lines: readonly Readonly<{ title: string; label: string; valueUsd: number }>[]; paid: boolean }>;

export type Live = Readonly<{
  access: Access;
  /** Whether the managed account is linked to the wallet; null when the engine did not say. */
  linked: boolean | null;
  /** Dollars the account can spend now; null when unread. */
  available: number | null;
  positionsValue: number | null;
  positions: readonly Position[];
  /** Positions the venues closed: resolved, sold out, or paid. */
  closed: readonly Position[];
  /** Ryntra's own records of live orders, newest first: the ones still on their way, and the history. */
  orders: readonly OrderLine[];
  payouts: readonly Payout[];
  receipts: readonly Receipt[];
  wallet: string | null;
}>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 600): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const IMAGE = /^https:\/\/[^\s"'<>]+$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACCESS = new Set(['off', 'app_paper', 'unknown', 'open']);

export function readAccess(raw: unknown): Access {
  const a = (raw ?? {}) as { state?: unknown; maxOrderUsd?: unknown; venues?: unknown };
  return {
    state: typeof a.state === 'string' && ACCESS.has(a.state) ? (a.state as Access['state']) : 'unknown',
    maxOrderUsd: num(a.maxOrderUsd) ?? 0,
    venues: Array.isArray(a.venues) ? a.venues.filter((v): v is string => typeof v === 'string') : [],
  };
}

type RawOutcome = { label?: unknown; totalSize?: unknown; avgEntryPrice?: unknown; currentPrice?: unknown; totalValue?: unknown; unrealizedPnl?: unknown; winner?: unknown; venues?: unknown };

/** The account's open positions, one line per side held. */
export function readPositions(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  const out: Position[] = [];
  for (const p of raw as { eventId?: unknown; venueEventId?: unknown; question?: unknown; image?: unknown; outcomes?: unknown; marketStatus?: unknown }[]) {
    if (!p || !Array.isArray(p.outcomes)) continue;
    const title = str(p.question, 300);
    if (!title) continue;
    for (const o of p.outcomes as RawOutcome[]) {
      const shares = num(o?.totalSize);
      const label = str(o?.label, 200);
      if (!label || shares === null || !(shares > 0)) continue;
      const venues = Array.isArray(o.venues) ? (o.venues as { outcomeId?: unknown; venueMarketId?: unknown }[]).filter((v) => typeof v?.outcomeId === 'string' && typeof v?.venueMarketId === 'string') : [];
      const eventId = typeof p.eventId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.eventId) ? p.eventId : null;
      const single = venues.length === 1 && eventId ? { outcomeId: venues[0]!.outcomeId as string, marketId: venues[0]!.venueMarketId as string } : null;
      const avg = num(o.avgEntryPrice);
      const pnl = num(o.unrealizedPnl);
      const cost = avg !== null ? avg * shares : null;
      out.push({
        key: `${String(p.venueEventId ?? eventId ?? title)}:${label}`,
        eventId,
        title,
        image: typeof p.image === 'string' && IMAGE.test(p.image) ? p.image : null,
        label,
        shares,
        avg,
        price: num(o.currentPrice),
        value: num(o.totalValue),
        pnl,
        // Against what the shares cost, from the engine's own two figures.
        pct: pnl !== null && cost !== null && cost > 0 ? Math.round((pnl / cost) * 1000) / 10 : null,
        sell: p.marketStatus === 'open' || p.marketStatus === undefined ? single : null,
        resolved: typeof o.winner === 'boolean',
      });
    }
  }
  return out;
}

/** An order's state as a person reads it. A part filled is taken: its shares are in the account. */
export function statusOf(state: OrderState): Status {
  return state === 'filled' || state === 'partially_filled' ? 'accepted' : state === 'submitted' ? 'pending' : 'failed';
}

/** The engine's live order records as lines: a Review never placed (still `reviewed`, or `expired`) is no order. */
export function readOrders(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderLine[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.quoteId !== 'string' || typeof r.state !== 'string' || !ORDER_STATES.has(r.state)) continue;
    const review = (r.review ?? {}) as { mode?: unknown; figures?: Record<string, unknown> };
    if (review.mode !== 'live' || r.state === 'reviewed' || r.state === 'expired') continue;
    const state = r.state as OrderState;
    const f = review.figures ?? {};
    out.push({
      quoteId: r.quoteId,
      eventId: typeof r.eventId === 'string' && ID.test(r.eventId) ? r.eventId : null,
      marketId: typeof r.venueMarketId === 'string' && ID.test(r.venueMarketId) ? r.venueMarketId : null,
      outcomeId: typeof r.outcomeId === 'string' && ID.test(r.outcomeId) ? r.outcomeId : null,
      title: str(r.eventTitle, 300) ?? str(r.question, 300) ?? '',
      label: str(r.outcomeLabel, 200) ?? '',
      side: r.side === 'sell' ? 'sell' : 'buy',
      totalUsd: num(f.totalUsd),
      shares: num(f.shares),
      price: num(f.probability),
      state,
      status: statusOf(state),
      at: typeof r.createdAt === 'string' ? r.createdAt : '',
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
}

function readPayouts(raw: unknown): Payout[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((p) => typeof p?.outcomeId === 'string' && ID.test(p.outcomeId) && num(p.valueUsd) !== null && (p.valueUsd as number) > 0)
    .map((p) => ({ outcomeId: p.outcomeId as string, title: str(p.question, 300) ?? '', label: str(p.label, 200) ?? '', valueUsd: p.valueUsd as number }));
}

function readReceipts(raw: unknown): Receipt[] {
  if (!Array.isArray(raw)) return [];
  const out: Receipt[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.redeemId !== 'string' || !Array.isArray(r.asked)) continue;
    const lines = (r.asked as Record<string, unknown>[]).filter((a) => num(a?.valueUsd) !== null).map((a) => ({ title: str(a.question, 300) ?? '', label: str(a.label, 200) ?? '', valueUsd: a.valueUsd as number }));
    const legs = Array.isArray(r.legs) ? (r.legs as { status?: unknown }[]) : [];
    out.push({
      id: r.redeemId,
      at: typeof r.createdAt === 'string' ? r.createdAt : '',
      totalUsd: Math.round(lines.reduce((sum, l) => sum + l.valueUsd, 0) * 100) / 100,
      lines,
      // Paid once a venue confirms it; a request only sent is not yet money.
      paid: legs.length > 0 && legs.every((l) => l?.status === 'confirmed'),
    });
  }
  return out;
}

/** `/api/predictions/live` as the window reads it; null for another shape. */
export function readLive(json: unknown): Live | null {
  if (!json || typeof json !== 'object' || !('access' in json)) return null;
  const body = json as { access?: unknown; account?: unknown; wallet?: unknown; redeemable?: unknown; receipts?: unknown };
  const access = readAccess(body.access);
  const account = (body.account ?? null) as {
    link?: { state?: unknown };
    balance?: { cashBalance?: unknown; positionsValue?: unknown } | null;
    positions?: unknown;
    closedPositions?: unknown;
    orders?: unknown;
  } | null;
  return {
    access,
    linked: account?.link && typeof account.link.state === 'string' ? account.link.state === 'active' : null,
    available: num(account?.balance?.cashBalance),
    positionsValue: num(account?.balance?.positionsValue),
    positions: readPositions(account?.positions),
    closed: readPositions(account?.closedPositions).map((p) => ({ ...p, sell: null })),
    orders: readOrders(account?.orders),
    payouts: readPayouts(body.redeemable),
    receipts: readReceipts(body.receipts),
    wallet: typeof body.wallet === 'string' ? body.wallet : null,
  };
}

/** Whether the account's link stands, from `/api/predictions/account`. */
export function readLinked(json: unknown): boolean | null {
  const state = (json as { link?: { state?: unknown } } | null)?.link?.state;
  return typeof state === 'string' ? state === 'active' : null;
}

export type Withdrawal = Readonly<{ requestId: string; phase: string; amountUsd: number | null; receiveUsd: number | null; at: string; aged: boolean }>;

export type Funding = Readonly<{
  enabled: boolean;
  wallet: string | null;
  deposit: Readonly<{ state: 'ready'; address: string }> | Readonly<{ state: 'preparing' | 'unsupported' | 'off' | 'failed' }>;
  available: number | null;
  withdrawMinUsd: number;
  withdrawals: readonly Withdrawal[];
}>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** `/api/predictions/funding` as the window reads it; null for another shape. */
export function readFunding(json: unknown): Funding | null {
  if (!json || typeof json !== 'object' || typeof (json as { enabled?: unknown }).enabled !== 'boolean') return null;
  const body = json as { enabled: boolean; wallet?: unknown; deposit?: { state?: unknown; address?: unknown }; balance?: { availableUsd?: unknown } | null; limits?: { withdrawMinUsd?: unknown }; withdrawals?: unknown };
  const d = body.deposit ?? {};
  const deposit: Funding['deposit'] =
    d.state === 'ready' && typeof d.address === 'string' && BASE58.test(d.address)
      ? { state: 'ready', address: d.address }
      : { state: d.state === 'preparing' || d.state === 'unsupported' || d.state === 'off' ? d.state : 'failed' };
  const withdrawals = Array.isArray(body.withdrawals)
    ? (body.withdrawals as Record<string, unknown>[])
        .filter((w) => typeof w?.requestId === 'string' && typeof w.phase === 'string')
        .map((w) => ({ requestId: w.requestId as string, phase: w.phase as string, amountUsd: num(w.amountUsd), receiveUsd: num(w.completedUsd) ?? num(w.reviewedReceiveUsd), at: typeof w.createdAt === 'string' ? w.createdAt : '', aged: w.aged === true }))
    : [];
  return {
    enabled: body.enabled,
    wallet: typeof body.wallet === 'string' ? body.wallet : null,
    deposit: body.enabled ? deposit : { state: 'off' },
    available: num(body.balance?.availableUsd),
    withdrawMinUsd: num(body.limits?.withdrawMinUsd) ?? 1,
    withdrawals,
  };
}

/** A withdrawal still on its way: the engine is asked about it again. */
export function moving(w: Withdrawal): boolean {
  return !w.aged && (w.phase === 'sending' || w.phase === 'in_flight' || w.phase === 'unknown');
}

export type Review = Readonly<{
  quoteId: string;
  side: 'buy' | 'sell';
  label: string;
  /** The average price the route fills at, 0–1. */
  price: number | null;
  shares: number;
  /** What leaves the account on a buy, fees included; what comes back on a sale. */
  totalUsd: number;
  feesUsd: number;
  /** A buy's payout if the side wins. */
  toWinUsd: number;
  maxLossUsd: number;
  expiresAt: string;
  live: boolean;
  canPlace: boolean;
  blockedBy: readonly string[];
}>;

/** The Review the engine stored for a quote; null for another shape. */
export function readReview(json: unknown): Review | null {
  const r = (json as { review?: unknown } | null)?.review as Record<string, unknown> | undefined;
  if (!r || typeof r.quoteId !== 'string' || (r.side !== 'buy' && r.side !== 'sell')) return null;
  const f = (r.figures ?? {}) as Record<string, unknown>;
  const route = (r.route ?? {}) as { expiresAt?: unknown };
  const outcome = (r.outcome ?? {}) as { label?: unknown };
  const shares = num(f.shares);
  const totalUsd = num(f.totalUsd);
  if (shares === null || totalUsd === null || typeof route.expiresAt !== 'string') return null;
  return {
    quoteId: r.quoteId,
    side: r.side,
    label: str(outcome.label, 200) ?? '',
    price: num(f.probability),
    shares,
    totalUsd,
    feesUsd: num(f.feesUsd) ?? 0,
    toWinUsd: num(f.payoutIfRightUsd) ?? 0,
    maxLossUsd: num(f.maxLossUsd) ?? totalUsd,
    expiresAt: route.expiresAt,
    live: r.mode === 'live',
    canPlace: r.canPlace === true,
    blockedBy: Array.isArray(r.blockedBy) ? r.blockedBy.filter((b): b is string => typeof b === 'string') : [],
  };
}

export type OrderState = 'reviewed' | 'submitted' | 'filled' | 'partially_filled' | 'failed' | 'expired' | 'cancelled';
const ORDER_STATES = new Set(['reviewed', 'submitted', 'filled', 'partially_filled', 'failed', 'expired', 'cancelled']);

/** Where a placed order stands; null for another shape. */
export function readOrder(json: unknown): Readonly<{ quoteId: string; state: OrderState }> | null {
  const o = (json as { order?: unknown } | null)?.order as { quoteId?: unknown; state?: unknown } | undefined;
  if (!o || typeof o.quoteId !== 'string' || typeof o.state !== 'string' || !ORDER_STATES.has(o.state)) return null;
  return { quoteId: o.quoteId, state: o.state as OrderState };
}

/** The least a live order spends, as the engine takes it. */
export const MIN_ORDER_USD = 1;

export type RealRefusal = 'amount' | 'min' | 'max' | 'cash' | 'closed' | 'access';

export const REAL_REFUSAL: Readonly<Record<RealRefusal, string>> = saidNow<RealRefusal>({
  amount: (w) => w.enterAmount,
  min: (w) => w.atLeast(MIN_ORDER_USD),
  max: (w) => w.aboveLimit,
  cash: (w) => w.realCash,
  closed: (w) => w.marketClosed,
  access: (w) => w.realAccess,
});

/** Why a real buy would not be asked for, before the Review; null when it would. */
export function realBuyRefusal(input: Readonly<{ spendUsd: number; access: Access | null; available: number | null; tradable: boolean }>): RealRefusal | null {
  if (!input.tradable) return 'closed';
  if (!input.access || input.access.state !== 'open') return 'access';
  if (!(input.spendUsd > 0) || !Number.isFinite(input.spendUsd)) return 'amount';
  if (input.spendUsd < MIN_ORDER_USD) return 'min';
  if (input.access.maxOrderUsd > 0 && input.spendUsd > input.access.maxOrderUsd) return 'max';
  if (input.available !== null && input.spendUsd > input.available + 1e-9) return 'cash';
  return null;
}

/** The engine's failure, said shortly in the city's words; the engine's own text never reaches the screen. */
export function failureWords(code: string): string {
  const w = wordsNow(PREDICT_TEXT);
  switch (code) {
    case 'NETWORK':
    case 'TIMEOUT':
    case 'PROVIDER_UNAVAILABLE':
    case 'UNAVAILABLE':
      return w.noAnswer;
    case 'UNAUTHORIZED':
    case 'WALLET_MISMATCH':
      return w.signInFirst;
    case 'NOT_LINKED':
    case 'SESSION_EXPIRED':
      return w.openAgain;
    case 'RATE_LIMITED':
      return w.tooMany;
    case 'CHALLENGE_REQUIRED':
    case 'CHALLENGE_FAILED':
      return w.busy;
    case 'QUOTE_EXPIRED':
      return w.priceMoved;
    case 'QUOTE_UNAVAILABLE':
      return w.noPrice;
    case 'ORDER_REFUSED':
      return w.notTaken;
    case 'FUNDING_OFF':
      return w.realClosed;
    case 'WITHDRAWAL_OPEN':
      return w.withdrawalOpen;
    case 'SIGNATURE_INVALID':
      return w.badSignature;
    case 'NOT_FOUND':
      return w.marketGone;
    default:
      return w.wentWrong;
  }
}

/** A withdrawal's state in a word. */
export function withdrawalWord(phase: string): string {
  const w = wordsNow(PREDICT_TEXT);
  switch (phase) {
    case 'completed':
      return w.arrived;
    case 'partial':
      return w.partlyArrived;
    case 'failed':
    case 'refused':
      return w.notSent;
    case 'in_flight':
    case 'sending':
      return w.onItsWay;
    default:
      return w.checking;
  }
}

/** A USDC amount the person typed, as raw units of six decimals; null when it does not read or is not above zero. */
export function usdcRaw(text: string): string | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{0,6})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const raw = BigInt(whole!) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  return raw > 0n ? raw.toString() : null;
}

/** Raw USDC as dollars. */
export function rawUsd(raw: unknown): number | null {
  return typeof raw === 'string' && /^\d{1,18}$/.test(raw) ? Number(raw) / 1e6 : null;
}

export type WithdrawPreview = Readonly<{ quoted: boolean; amountRaw: string; receiveRaw: string | null; feeRaw: string | null; reason: string | null }>;

export function readWithdrawPreview(json: unknown): WithdrawPreview | null {
  const p = (json as { preview?: unknown } | null)?.preview as Record<string, unknown> | undefined;
  if (!p || typeof p.amountRaw !== 'string' || (p.status !== 'quoted' && p.status !== 'unviable')) return null;
  const raw = (v: unknown) => (typeof v === 'string' && /^\d{1,18}$/.test(v) ? v : null);
  return { quoted: p.status === 'quoted', amountRaw: p.amountRaw, receiveRaw: raw(p.receiveRaw), feeRaw: raw(p.feeRaw), reason: typeof p.reason === 'string' ? p.reason : null };
}

/** Why a withdrawal cannot go, in a few words. */
export function withdrawReason(reason: string | null): string {
  const w = wordsNow(PREDICT_TEXT);
  switch (reason) {
    case 'below_minimum':
      return w.atLeast(1);
    case 'insufficient':
      return w.moreThanHeld;
    case 'above_max':
      return w.moreThanCan;
    case 'fee_exceeds':
      return w.feeOverAmount;
    case 'route_unavailable':
      return w.notAvailable;
    default:
      return w.cannotGo;
  }
}
