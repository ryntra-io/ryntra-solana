import type { SolanaWalletAction } from '../../../lib/solana/action-ledger.ts';
import { explorerTxUrl } from '../../../lib/solana/explorer.ts';
import { receiptFetchable } from '../../../lib/solana/receipt-fetch.client.ts';
import { findReceiptForAction, type StoredReceiptView } from '../../../lib/solana/receipt-view.ts';
import { EVM_EXPLORER_TX, type SwapNetwork } from '../../../lib/swap/catalog.ts';
import { actionStateWord, describeAction } from '../../../app/solana/workspace/history/history-lines.ts';
import { dateText, digits, wordsNow } from '../i18n/dict.ts';
import { shortFigures } from '../i18n/figures.ts';
import { ask, type FetchLike } from './engine.ts';
import { sayer } from './say.ts';
import { ACTIVITY_WORDS, HISTORY_WORDS } from './words.ts';

/**
 * Activity: what this wallet did through Ryntra, as the engine's ledger says it (`POST /api/solana/activity`) — each
 * lane's own record re-read for where it stands now — worded the way Ryntra's History words it, so one transfer never
 * reads two ways. A row opens its transaction on the chain and its receipt: the copy this browser keeps, or the one
 * the engine can issue again for that lane. Nothing is listed that the ledger did not record, and a ledger read by
 * halves says so.
 */

/** History's shared words, said in the city's language (English as written). */
const SAY = sayer(HISTORY_WORDS);

export type ActivityRead = Readonly<{ actions: readonly SolanaWalletAction[]; complete: boolean; at: number }>;

function isAction(value: unknown): value is SolanaWalletAction {
  const row = value as Record<string, unknown> | null;
  return !!row && typeof row.actionId === 'string' && typeof row.lane === 'string' && typeof row.outcome === 'string' && typeof row.startedAt === 'string';
}

export async function readActivity(fetchImpl: FetchLike, owner: string, now: () => number): Promise<ActivityRead | null> {
  const answer = await ask<{ actions?: unknown; complete?: unknown }>(fetchImpl, '/api/solana/activity', { body: { owner, network: 'mainnet' } });
  if (!answer.ok || !Array.isArray(answer.value?.actions)) return null;
  const actions = answer.value.actions.filter(isAction);
  return { actions, complete: answer.value.complete !== false && actions.length === answer.value.actions.length, at: now() };
}

export type Tone = 'done' | 'moving' | 'failed' | 'you';

export type ActivityLine = Readonly<{
  id: string;
  title: string;
  sub: string;
  state: string;
  tone: Tone;
  when: string;
  /** The transaction on its chain; null when there is none to show. */
  link: Readonly<{ label: string; href: string }> | null;
  /** Whether a receipt can be had: kept here, or issued again by the engine. */
  receipt: 'kept' | 'fetchable' | null;
}>;

const TONE: Readonly<Record<SolanaWalletAction['outcome'], Tone>> = { DONE: 'done', FAILED: 'failed', NEEDS_YOU: 'you', IN_FLIGHT: 'moving' };

/** When, as a row says it: 14:05 today, 12 Oct otherwise. */
export function whenWords(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const date = new Date(at);
  const today = new Date(now);
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay
    ? dateText(date, { hour: '2-digit', minute: '2-digit' })
    : dateText(date, { day: 'numeric', month: 'short' });
}

const EVM_OF: Readonly<Record<string, Exclude<SwapNetwork, 'solana'>>> = { BASE: 'base', ETHEREUM: 'ethereum', ROBINHOOD: 'robinhood' };

function linkOf(action: SolanaWalletAction): ActivityLine['link'] {
  if (action.signature) return { label: 'Solana', href: explorerTxUrl(action.network, action.signature) };
  if (action.sourceTx && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(action.sourceTx)) return { label: 'Solana', href: explorerTxUrl(action.network, action.sourceTx) };
  const evm = action.destination ? EVM_OF[action.destination] : undefined;
  if (evm && action.destinationTx && /^0x[0-9a-fA-F]{64}$/.test(action.destinationTx)) return { label: wordsNow(ACTIVITY_WORDS).explorer, href: `${EVM_EXPLORER_TX[evm]}${action.destinationTx}` };
  return null;
}

/** The rows as the window shows them, newest first. */
export function activityLines(actions: readonly SolanaWalletAction[], kept: readonly StoredReceiptView[], now: number): ActivityLine[] {
  return [...actions]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((action) => {
      const words = describeAction(action, SAY);
      return {
        id: action.actionId,
        // History's words carry the ledger's exact figures (0.099796891 SOL): the row shortens them, the receipt keeps them.
        title: digits(shortFigures(words.title)),
        sub: digits(shortFigures(words.sub)),
        state: actionStateWord(action.outcome, SAY),
        tone: TONE[action.outcome] ?? 'moving',
        when: whenWords(action.startedAt, now),
        link: linkOf(action),
        receipt: findReceiptForAction(kept, action) ? 'kept' : receiptFetchable(action) ? 'fetchable' : null,
      };
    });
}
