import { digits } from '../../../city/lib/i18n/dict.ts';
import type { Lang } from '../../../city/lib/i18n/langs.ts';
import { solPlain } from '../figures.ts';
import type { PaperView } from '../../../lib/mandate/paper/model.ts';

/**
 * How the paper week's card reads the paper agent: when it stands, what its figures say, and what a refusal
 * of the route means on screen. Pure: the card and the tests share it.
 */

/** Whether the screen opens the paper week: the deployment's switch, exactly `open`. Closed — the practice as it was. */
export const paperOpen = (flag: string | undefined): boolean => flag?.trim().toLowerCase() === 'open';

/**
 * What the card says when the paper week could not start or be read. The start is the proven wallet's: `wallet` — no wallet connected; `declined` — she said no to the one signature; `proof` — the wallet did not
 * sign, or its proof was not taken; `limited` — this wallet (or this network) started paper too often lately.
 */
export type PaperIssue = 'closed' | 'price' | 'pair' | 'full' | 'limited' | 'wallet' | 'declined' | 'proof' | 'network';

/** The issues that are about the one signature: the card's line keeps its «i» beside them. */
export const SIGN_ISSUES: ReadonlySet<PaperIssue> = new Set(['wallet', 'declined', 'proof']);

/** The route's refusal as the card says it. */
export function issueOf(status: number, code: string | null): PaperIssue {
  if (code === 'PAPER_CLOSED' || code === 'PAPER_NO_STORE') return 'closed';
  if (code === 'PAPER_NO_PRICE') return 'price';
  if (code === 'PAPER_PAIR') return 'pair';
  /* This wallet's starts, or a flood from one network: said as such — not as a full paper. */
  if (code === 'PAPER_LIMITED' || code === 'RATE_LIMITED' || status === 429) return 'limited';
  /* A full store, paper's share of quotes spent now: «try a bit later». */
  if (code === 'PAPER_FULL' || code === 'PAPER_BUSY') return 'full';
  if (status === 401 || code === 'WALLET_MISMATCH') return 'proof';
  if (status === 404) return 'closed';
  return 'network';
}

/** Whether the card shows this paper week: at work, or done with its result — not one she ended or took live. */
export const shownOf = (view: PaperView | null): boolean => view !== null && view.paper === true && (view.status === 'working' || view.status === 'paused' || view.status === 'done');

/** Whether «Start with money» is still the card's action. */
export const liveOpen = (view: PaperView | null): boolean => view !== null && view.status !== 'ended' && view.status !== 'live';

const SIGNED = /^-?\d{1,30}$/u;

/** Lamports as signed SOL: «+0.0012», «−0.0040», «0»; «—» for a figure not read. */
export function signedSol(raw: string | null, lang: Lang): string {
  if (raw === null || !SIGNED.test(raw)) return '—';
  const negative = raw.startsWith('-');
  const body = solPlain(negative ? raw.slice(1) : raw, lang);
  if (/^0([.,]0+)?$/u.test(body)) return digits('0', lang);
  return `${negative ? '−' : '+'}${body}`;
}

/** The tone of a signed figure: only a move is coloured. */
export function toneOf(raw: string | null): 'up' | 'down' | undefined {
  if (raw === null || !SIGNED.test(raw) || /^-?0+$/u.test(raw)) return undefined;
  return raw.startsWith('-') ? 'down' : 'up';
}

/** The paper agent's fees, Ryntra's and the network's, and the fee of selling back: lamports, summed. */
export function feesOf(view: PaperView): string | null {
  if (view.net.feesRaw === null) return null;
  return (BigInt(view.buyFeesRaw) + BigInt(view.net.feesRaw)).toString();
}

/** The line under the result: what holds it now, as one word key. */
export type PaperLine =
  | 'first'
  | 'paused'
  | 'pausedLoss'
  | 'pausedLosses'
  | 'pausedStop'
  | 'pausedTake'
  | 'pausedLate'
  | 'pausedUnread'
  | 'pausedFailing'
  | 'doneWeek'
  | 'doneSpent'
  | null;

export function lineOf(view: PaperView): PaperLine {
  if (view.status === 'done') return view.doneBy === 'spent' ? 'doneSpent' : 'doneWeek';
  if (view.status === 'paused') {
    const by: Readonly<Record<string, PaperLine>> = { loss: 'pausedLoss', losses: 'pausedLosses', stop: 'pausedStop', take: 'pausedTake', late: 'pausedLate', unread: 'pausedUnread', failing: 'pausedFailing' };
    return (view.pausedBy && by[view.pausedBy]) || 'paused';
  }
  return view.trades === 0 ? 'first' : null;
}
