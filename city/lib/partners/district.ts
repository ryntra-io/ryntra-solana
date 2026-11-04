import { dateText } from '../i18n/dict.ts';
import type { Lang } from '../i18n/langs.ts';
import { addUsd } from '../scouts/view.ts';

/**
 * «Мій район» (CITY-127): the partner's own figures, read from the same `/api/rewards` answer «Scouts» reads, and
 * nothing the engine does not say. A partner earns on one level (decision 93): what the people they brought traded —
 * the engine's `REFERRAL_L1` — and nothing else; a person's own cashback and a second level are not a partner's.
 * Where the engine has no figure yet (link clicks by channel, first trades, active people) the field is null and the
 * window draws its empty state, never a guess. Nothing is paid until the revenue ledger runs (PRT-2): claimable reads
 * $0.00 unless the engine itself says a claim may be made. The engine's rules are read, never written here.
 */

export type ReceiptKind = 'REFERRAL_L1' | 'CLAIM';

export type Receipt = Readonly<{
  kind: ReceiptKind;
  /** `12.40`, `<0.01`, or `—` while the share has no dollar value yet. */
  amount: string;
  out: boolean;
  /** The coin of the fee, when the engine names one. */
  coin: string | null;
  at: string;
}>;

export type FunnelStep = 'clicks' | 'wallets' | 'firstTrade' | 'active';
export const FUNNEL: readonly FunnelStep[] = ['clicks', 'wallets', 'firstTrade', 'active'];

export type DistrictView = Readonly<{
  /**
   * COUNTED while nothing may be claimed; OPEN once the engine says a claim may be made; WEEKLY once the weekly payout
   * runs (CITY-128): the figures are then decision 93's, from `/api/partners/earnings`, and «claimable» is what the next
   * weekly payout owes.
   */
  state: 'COUNTED' | 'OPEN' | 'WEEKLY';
  /** The partner's share from the people they brought, counted so far. */
  accrued: string;
  claimable: string;
  paid: string;
  /** The people who came through the partner's link. */
  brought: number | null;
  funnel: Readonly<Record<FunnelStep, number | null>>;
  /** The partner's share by product: swaps today; launches once they are counted (null — not counted yet). */
  swap: string;
  launch: string | null;
  receipts: readonly Receipt[];
  link: string | null;
  code: string | null;
}>;

const KINDS: ReadonlySet<string> = new Set<ReceiptKind>(['REFERRAL_L1', 'CLAIM']);
const USD = /^(?:<0\.01|\d+\.\d{2})$/;
const CODE = /^[0-9A-Z]{6,24}$/;

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const usd = (value: unknown): string => (typeof value === 'string' && USD.test(value) ? value : '0.00');
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** The engine's answer as «Мій район» reads it; null when it is not the answer of a proven wallet. */
export function districtOf(body: unknown): DistrictView | null {
  const answer = record(body);
  if (answer.ok !== true) return null;
  const referral = record(answer.referral);
  const referrals = record(answer.referrals);
  const receipts: Receipt[] = [];
  for (const raw of Array.isArray(answer.rows) ? answer.rows : []) {
    const row = record(raw);
    if (typeof row.kind !== 'string' || !KINDS.has(row.kind) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) continue;
    const detail = typeof row.detail === 'string' ? row.detail.split(' · ')[0]!.trim() : '';
    receipts.push({
      kind: row.kind as ReceiptKind,
      amount: typeof row.amount === 'string' && (USD.test(row.amount) || row.amount === '—') ? row.amount : '—',
      out: row.kind === 'CLAIM',
      coin: detail || null,
      at: row.at,
    });
  }
  receipts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const paid = receipts.filter((r) => r.kind === 'CLAIM' && USD.test(r.amount)).reduce((sum, r) => addUsd(sum, r.amount), '0.00');
  const open = answer.claimable === true;
  const share = usd(answer.referralL1);
  const code = typeof referral.code === 'string' && CODE.test(referral.code) ? referral.code : null;
  const brought = count(referrals.level1);
  return {
    state: open ? 'OPEN' : 'COUNTED',
    accrued: share,
    claimable: open ? usd(answer.available) : '0.00',
    paid,
    brought,
    funnel: { clicks: null, wallets: brought, firstTrade: null, active: null },
    swap: share,
    launch: null,
    receipts,
    link: typeof referral.link === 'string' && /^https?:\/\//.test(referral.link) ? referral.link : null,
    code,
  };
}

/**
 * The weekly payout's own figures over the Rewards answer (CITY-128): counted, owed and paid under decision 93's
 * terms. Anything but a running payout's answer leaves the view as it was.
 */
export function withEarnings(view: DistrictView, body: unknown): DistrictView {
  const answer = record(body);
  if (answer.ok !== true || answer.on !== true) return view;
  if (![answer.accrued, answer.pending, answer.paid, answer.swap, answer.launch].every((value) => typeof value === 'string' && USD.test(value))) return view;
  return { ...view, state: 'WEEKLY', accrued: answer.accrued as string, claimable: answer.pending as string, paid: answer.paid as string, swap: answer.swap as string, launch: answer.launch as string };
}

/** True when the funnel has nothing to draw: no step the engine counted holds a person yet. */
export function funnelEmpty(funnel: DistrictView['funnel']): boolean {
  return FUNNEL.every((step) => !funnel[step]);
}

/** How long ago, short, in the language on screen: `now`, `5m`, `3h`, `2d` · `щойно`, `5 хв`, `3 год`, `2 д`; then the day. */
export function agoIn(at: string, now: number, lang: Lang): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  const uk = lang === 'uk';
  if (ms < 60_000) return uk ? 'щойно' : 'now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}${uk ? ' хв' : 'm'}`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}${uk ? ' год' : 'h'}`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}${uk ? ' д' : 'd'}`;
  return dateText(Date.parse(at), { day: 'numeric', month: 'short' }, lang);
}

/* ------------------------------------------------------------------- CSV */

const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The receipts as a spreadsheet: one row a receipt, newest first, dollars signed. */
export function receiptsCsv(receipts: readonly Receipt[]): string {
  const lines = ['date,kind,usd,coin'];
  for (const r of receipts) {
    const amount = r.amount === '—' ? '' : r.amount === '<0.01' ? '0.00' : `${r.out ? '-' : ''}${r.amount}`;
    lines.push([r.at, r.kind, amount, r.coin ?? ''].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------ the link kit */

export const CHANNELS = ['x', 'telegram', 'youtube', 'discord', 'tiktok'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * The link with a channel's mark: `ryntra.io/app?ref=CODE&sub=x`. The address layer turns `?ref=` into the counted
 * `/r/<code>` (first touch, the open counted) and lands the friend on the product with the mark kept.
 */
export function channelLink(link: string, code: string, channel: Channel): string {
  let origin: string;
  try {
    origin = new URL(link).origin;
  } catch {
    return link;
  }
  return `${origin}/app?${new URLSearchParams({ ref: code, sub: channel })}`;
}

/** The link as the window shows it: no scheme, no trailing slash. */
export function bare(link: string): string {
  return link.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/* --------------------------------------------------------------- the demo */

/**
 * The figures the window shows in development (`?partners=demo`) for the eyes and the screenshots — never in
 * production, and always under the fixed «ДЕМО · не твої дані» mark.
 */
export const DEMO_ANSWER = {
  ok: true,
  available: '0.00',
  pending: '18.40',
  lifetime: '64.20',
  cashback: '9.10',
  referralL1: '52.35',
  referralL2: '0.00',
  claimable: false,
  referrals: { level1: 23, level2: 0 },
  referral: { code: 'K7Q2M9XW4HPT', link: 'https://ryntra.io/r/K7Q2M9XW4HPT' },
  rows: [
    { kind: 'REFERRAL_L1', display: '+$4.20', amount: '4.20', detail: 'BONK', at: '2026-10-29T10:00:00.000Z' },
    { kind: 'REFERRAL_L1', display: '+$2.75', amount: '2.75', detail: 'SOL', at: '2026-10-29T08:10:00.000Z' },
    { kind: 'CASHBACK', display: '+$1.10', amount: '1.10', detail: 'WIF', at: '2026-10-28T21:40:00.000Z' },
    { kind: 'REFERRAL_L1', display: '+$6.40', amount: '6.40', detail: 'POPCAT', at: '2026-10-27T17:30:00.000Z' },
    { kind: 'REFERRAL_L1', display: '+$3.05', amount: '3.05', detail: 'JUP', at: '2026-10-26T12:00:00.000Z' },
    { kind: 'REFERRAL_L1', display: '—', amount: '—', detail: 'TRUMP', at: '2026-10-25T09:00:00.000Z' },
  ],
} as const;
