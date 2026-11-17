import { earnWords } from '../../city/lib/earn/words.ts';
import { LANGS } from '../../city/lib/i18n/langs.ts';
import type { TextKey } from '../../city/lib/i18n/dict.ts';
import type { EARN } from './words.ts';

/**
 * The pool stores' refusals, in the terminal's words. The city's stores keep a refusal as the sentence its own window
 * says — «the Harbor», «pier» — and no code beside it. Their sentence is looked up where the store took it, which gives
 * the refusal's code back; the terminal then says the same thing in plain names. The stores stay exactly as they are.
 *
 * Pure: the tickets and the tests read it alike.
 */

export type Venue = 'pool' | 'pro';
type Key = TextKey<typeof EARN>;

/** The code a store's notice was written for, or null when the sentence is not one of that store's own. */
export function noticeCode(text: string, venue: Venue): string | null {
  for (const lang of LANGS) {
    const all = earnWords(lang);
    const book = venue === 'pool' ? all.pier : all.pro;
    if (text === book.fresh) return 'FRESH';
    for (const [code, said] of Object.entries(book.failures)) if (said === text) return code;
  }
  return null;
}

/** The pools of the city's own list: only its door's refusals carry the city's words; the rest are plain already. */
const POOL: Readonly<Record<string, Key>> = {
  FRESH: 'fresh',
  PIER_CLOSED: 'fClosed',
  PIER_STOPPED: 'fPaused',
  PIER_CEILING: 'fCeiling',
  PIER_UNPRICED: 'fUnpriced',
  PIER_PAIR: 'fPool',
  PIER_VENUE: 'fPool',
  ZAP_PRICE: 'fSwapPrice',
  ZAP_UNPRICED: 'fUnpriced',
  ZAP_NO_ROUTE: 'fNoRoute',
  NOTHING_TO_WITHDRAW: 'fNothingLeft',
};

const PRO: Readonly<Record<string, Key>> = {
  FRESH: 'fresh',
  UNAVAILABLE: 'fNetwork',
  VALIDATION_ERROR: 'notSent',
  STOPPED: 'fPaused',
  NOT_A_PIER: 'fPool',
  PIER_NOT_OPEN: 'fPool',
  AMOUNT_LOW: 'fLow',
  AMOUNT_HIGH: 'fCeiling',
  CARE_CLOSED: 'notSent',
  BALANCE_LOW: 'fBalance',
  NOTHING_TO_DO: 'fNothing',
  REFUSED: 'fRefused',
  TICKET_INVALID: 'fStale',
  SIGNED_MISMATCH: 'notSent',
  NOT_SIGNED: 'cancelled',
  SIMULATION_FAILED: 'fBand',
  WALLET_REFUSED: 'cancelled',
  WALLET_MISMATCH: 'fWallet',
  CAPABILITY_UNAVAILABLE: 'fPool',
  RATE_LIMITED: 'fBusy',
};

/**
 * Which of the terminal's sentences says a store's notice: a key of the screen's words, or null — then, for a pool of
 * the city's own list, the notice's sentence is plain already and is shown as it is.
 */
export function noticeKey(text: string, venue: Venue): Key | null {
  const code = noticeCode(text, venue);
  const book = venue === 'pool' ? POOL : PRO;
  if (code !== null && Object.hasOwn(book, code)) return book[code]!;
  // A Pro refusal the terminal has no sentence for is still never said in the city's words.
  return venue === 'pro' ? 'notSent' : null;
}
