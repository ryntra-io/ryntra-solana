import type { PayLink } from '../../lib/api/v1/contract.ts';
import { MONEY_PATH } from '../shell/shelves.ts';

/**
 * «Money» as data: the section's address and tabs, where the old panels of
 * the Portfolio lead now, and the payment links («Invoices») — what the form may send to the engine
 * (`POST /api/v1/pay/requests`, contract 1.22.0) and how a link of the person's own list reads (`GET` of the same).
 * The engine (`lib/pay/**`) decides everything: the recipient is always the proven wallet, the status is the chain's.
 *
 * Pure: no clock it is not given, no network, no store — the tests read it as it is.
 */

/** The section's own address (the Portfolio shelf's, `../shell/shelves.ts`); its tabs are `?tab=` of it, the first one with no part at all. */
export { MONEY_PATH };

export const MONEY_TABS = ['send', 'receive', 'invoices'] as const;
export type MoneyTab = (typeof MONEY_TABS)[number];

export function isMoneyTab(value: unknown): value is MoneyTab {
  return typeof value === 'string' && (MONEY_TABS as readonly string[]).includes(value);
}

/**
 * The tabs that stand: «Send» only where this deployment lets money move (the money switch, `flowLive('send')`);
 * «Receive» and «Invoices» move nothing and always stand. «Private», «Contacts» and «Autopay» have no screen yet: no tab.
 */
export function tabsShown(sends: boolean): MoneyTab[] {
  return MONEY_TABS.filter((tab) => tab !== 'send' || sends);
}

/** The tab the section opens on: «Send» where it stands, «Receive» otherwise. */
export function firstTab(sends: boolean): MoneyTab {
  return sends ? 'send' : 'receive';
}

/** A tab's address: the first tab is the section's address itself. */
export function moneyHref(tab: MoneyTab, sends = true): string {
  return tab === firstTab(sends) ? MONEY_PATH : `${MONEY_PATH}?tab=${tab}`;
}

/**
 * Where the Portfolio's old panels lead now (`/portfolio?act=send`, `?act=receive` — the agent's «send …», the old
 * «Send» of the Swap): the same tab of «Money». Any other panel stays the Portfolio's.
 */
export function forwardOf(act: string | null | undefined, sends: boolean): string | null {
  if (act === 'send') return sends ? moneyHref('send', sends) : moneyHref('receive', sends);
  if (act === 'receive') return moneyHref('receive', sends);
  return null;
}

/* ── payment links ─────────────────────────────────────────────────────────────────────────────────────────────── */

export const PAY_ENDPOINT = '/api/v1/pay/requests';

/** The coins a link asks for — USDC first, as people pay; SOL is the engine's `mint: null`. */
export const INVOICE_COINS = [
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  { symbol: 'SOL', mint: null, decimals: 9 },
] as const;
export type InvoiceCoin = (typeof INVOICE_COINS)[number];

/** How long a link is valid: the engine's own presets (`lib/pay/model.ts`), 7 days unless the person picks another. */
export const EXPIRIES = ['1h', '24h', '7d', '30d'] as const;
export type Expiry = (typeof EXPIRIES)[number];
export const DEFAULT_EXPIRY: Expiry = '7d';

/** The engine's bound on «what it is for». */
export const DESCRIPTION_MAX = 120;

/**
 * The amount as the engine reads it, or null while it is not one: a positive decimal with no more places than the coin
 * has — more is refused, never rounded (the engine's own rule, `lib/solana/amounts.ts`). `typed` is already plain (a
 * point, no spaces: `cleanAmount`).
 */
export function invoiceAmount(typed: string, coin: InvoiceCoin): string | null {
  const plain = typed.trim();
  if (!/^\d*\.?\d*$/.test(plain) || plain === '' || plain === '.') return null;
  const [whole = '', part = ''] = plain.split('.');
  if (part.length > coin.decimals) return null;
  const tidyWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  const tidyPart = part.replace(/0+$/, '');
  if (/^0*$/.test(tidyWhole) && tidyPart === '') return null;
  return tidyPart ? `${tidyWhole}.${tidyPart}` : tidyWhole;
}

export type CreateBody = Readonly<{ mint: string | null; amount: string; description: string | null; expiration: Expiry }>;

/** What the form sends to the engine — exactly the contract's fields; the recipient is never one of them. */
export function createBody(coin: InvoiceCoin, amount: string, description: string, expiration: Expiry): CreateBody {
  const said = description.trim().slice(0, DESCRIPTION_MAX);
  return { mint: coin.mint, amount, description: said === '' ? null : said, expiration };
}

/** One link of the person's own list — only what the screen shows. */
export type Invoice = Readonly<{
  id: string;
  url: string;
  payUrl: string;
  status: PayLink['status'];
  note: PayLink['note'];
  symbol: string;
  /** The amount asked, as the creator typed it; null — the payer chooses. */
  asked: string | null;
  description: string | null;
  createdAt: string;
  expiresAt: string;
  /** What arrived in the asked coin so far, in its units; null — nothing yet. */
  received: string | null;
  /** The settling payment, when the link is paid: its signature (who paid is on it) and when. */
  paid: Readonly<{ signature: string; at: string | null }> | null;
}>;

const STATUSES: readonly PayLink['status'][] = ['AWAITING', 'PAID', 'EXPIRED', 'CHECKING', 'UNKNOWN'];
const NOTES: readonly NonNullable<PayLink['note']>[] = ['UNDERPAID', 'WRONG_TOKEN', 'OVERPAID'];
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** One link of the engine's answer, or null when it is not one the screen can show. */
export function invoiceOf(raw: unknown): Invoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const link = raw as Record<string, unknown>;
  const id = text(link.id);
  const url = text(link.url);
  const status = link.status as PayLink['status'];
  const token = link.token as Record<string, unknown> | null | undefined;
  const symbol = text(token?.symbol);
  if (!id || !url || !symbol || !STATUSES.includes(status)) return null;
  const note = NOTES.includes(link.note as NonNullable<PayLink['note']>) ? (link.note as PayLink['note']) : null;
  const amount = link.amount as Record<string, unknown> | null | undefined;
  const received = link.received as Record<string, unknown> | null | undefined;
  const paid = link.paid as Record<string, unknown> | null | undefined;
  const signature = text(paid?.signature);
  return {
    id,
    url,
    payUrl: text(link.payUrl) ?? url,
    status,
    note,
    symbol,
    asked: text(amount?.display),
    description: text(link.description),
    createdAt: text(link.createdAt) ?? '',
    expiresAt: text(link.expiresAt) ?? '',
    received: text(received?.amount) ?? text(paid?.credited),
    paid: signature ? { signature, at: text(paid?.paidAt) } : null,
  };
}

/** What the person's list reads as: the links, or locked — the proof is missing, or is another wallet's. */
export type ListRead = Readonly<{ state: 'ready'; links: readonly Invoice[] }> | Readonly<{ state: 'locked' }> | Readonly<{ state: 'failed' }>;

/** The engine's answer to `GET /api/v1/pay/requests` for this wallet. */
export function listOf(status: number, body: unknown, owner: string): ListRead {
  if (status === 401) return { state: 'locked' };
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { state: 'failed' };
  const answer = body as { address?: unknown; links?: unknown };
  // A proof this browser holds for another wallet lists that wallet's links: never shown as this one's.
  if (answer.address !== owner) return { state: 'locked' };
  if (!Array.isArray(answer.links)) return { state: 'failed' };
  return { state: 'ready', links: answer.links.map(invoiceOf).filter((link): link is Invoice => link !== null) };
}

/** A link's state on screen: mint — paid; amber — still to come; plain — over. A mismatch speaks louder than the state. */
export type InvoiceTone = 'ok' | 'warn' | 'plain';

export function toneOf(link: Pick<Invoice, 'status' | 'note'>): InvoiceTone {
  if (link.status === 'PAID') return link.note === 'OVERPAID' || link.note === null ? 'ok' : 'warn';
  if (link.status === 'AWAITING' || link.status === 'CHECKING') return 'warn';
  return 'plain';
}

/** The word a link's state says: a mismatch (less, more, another coin) before the bare state. */
export function stateKey(link: Pick<Invoice, 'status' | 'note'>): PayLink['status'] | NonNullable<PayLink['note']> {
  return link.note ?? link.status;
}
