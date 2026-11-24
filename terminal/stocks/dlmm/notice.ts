import type { TextKey } from '../../../city/lib/i18n/dict.ts';
import type { EARN } from '../../earn/words.ts';

/**
 * A refusal of the stock door, of the engine or of the wallet, in the ticket's words: the stock's own
 * where the door said it (closed to this wallet, the issuer's pause), Earn's for the rest. A code the ticket has no
 * sentence for says that nothing was sent. Pure.
 */

export type NoticeWord = Readonly<{ book: 'earn'; key: TextKey<typeof EARN> }> | Readonly<{ book: 'stock'; key: 'closed' | 'paused' }>;

const EARN_OF: Readonly<Record<string, TextKey<typeof EARN>>> = {
  FRESH: 'fresh',
  DLMM_STOCKS_STOPPED: 'fPaused',
  DLMM_STOCK_PAIR: 'fPool',
  POOL_NOT_FOUND: 'fPool',
  POOL_DISABLED: 'fPool',
  UNAVAILABLE: 'fNetwork',
  NETWORK: 'fNetwork',
  TIMEOUT: 'fNetwork',
  SIMULATION_FAILED: 'fRefused',
  PREVIEW_EXPIRED: 'fStale',
  TICKET_EXPIRED: 'fStale',
  TICKET_INVALID: 'fStale',
  WALLET_REFUSED: 'cancelled',
  NOT_SIGNED: 'cancelled',
  WALLET_MISMATCH: 'fWallet',
  RATE_LIMITED: 'fBusy',
};

export function noticeWord(code: string): NoticeWord {
  if (code === 'DLMM_STOCKS_CLOSED' || code === 'ACTIONS_CLOSED') return { book: 'stock', key: 'closed' };
  if (code === 'DLMM_STOCK_PAUSED') return { book: 'stock', key: 'paused' };
  return { book: 'earn', key: Object.hasOwn(EARN_OF, code) ? EARN_OF[code]! : 'notSent' };
}
