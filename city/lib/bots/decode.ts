import { KIND_FACTS, type Custody } from './kinds.ts';
import type { BotDraft, ExitPolicy } from './draft.ts';

/**
 * «What this bot can do» — the card under every start: the pair, the most it ever uses, where the money sits, who can
 * move it and how to close. Read now from the draft; once a live start builds a transaction, the same card is read
 * from that transaction's own instructions (`source: 'transaction'`) and must say the same, or the start stops.
 */

export type CanDo = Readonly<{
  pair: string;
  maxUsd: number;
  custody: Custody;
  /** Who can take the money out: only the person's wallet, whatever the bot. */
  withdraw: 'wallet';
  /** How the bot is closed. */
  close: 'withdraw' | 'cancel' | 'turnOff';
  /** Trades it makes without asking. */
  tradesAlone: boolean;
  /** How it trades: by itself, by the person's tap, or its ladder by itself and the rest by a tap. */
  trades: 'alone' | 'tap' | 'both';
  standalone: boolean;
  exit: ExitPolicy | null;
  source: 'draft' | 'transaction';
}>;

export function canDoFromDraft(draft: BotDraft): CanDo {
  const facts = KIND_FACTS[draft.kind];
  return {
    pair: `${draft.pair.symbol}/USDC`,
    maxUsd: draft.amountUsd,
    custody: facts.custody,
    withdraw: 'wallet',
    close: facts.custody === 'position' ? 'withdraw' : facts.custody === 'order' ? 'cancel' : 'turnOff',
    tradesAlone: facts.drive === 'chain',
    trades: facts.drive === 'chain' ? 'alone' : facts.drive === 'both' ? 'both' : 'tap',
    standalone: facts.standalone,
    exit: facts.ranged ? draft.exit : null,
    source: 'draft',
  };
}

/** Whether two readings of the card agree on everything a person relies on. */
export function sameCanDo(a: CanDo, b: CanDo): boolean {
  return a.pair === b.pair && a.maxUsd === b.maxUsd && a.custody === b.custody && a.withdraw === b.withdraw && a.close === b.close && a.tradesAlone === b.tradesAlone && a.trades === b.trades && a.exit === b.exit;
}
