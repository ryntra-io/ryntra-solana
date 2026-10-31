import type { LaunchClaimReviewResponse } from '../../../lib/api/v1/contract.ts';
import { dateText, digits } from '../i18n/dict.ts';
import type { Lang } from '../i18n/langs.ts';
import { unitsOf } from './berth.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, CLAIM_CLOSED, WALLET_REFUSED, type ClaimFailure } from './berth-flow.ts';
import { BERTH } from './words.ts';

/**
 * How the berth says the engine's figures, in the language on screen (CITY-79): money earned and received rounded down
 * to the cent, so nothing ever reads better than it is; a dollar pair as dollars, any other by its ticker. The words are
 * `BERTH`.
 */

type Pair = Readonly<{ symbol: string; decimals: number; dollar: boolean }>;
type Pocket = LaunchClaimReviewResponse['pockets'][number];

const EN = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An amount in the pair currency: $1,284.60 · 18.64 USDC · <$0.01 — rounded down, never up. */
export function amountText(value: number, pair: Pair, lang: Lang): string {
  const cents = Math.floor(value * 100 + 1e-9) / 100;
  if (value > 0 && cents === 0) return pair.dollar ? '<$0.01' : digits(`<0.01 ${pair.symbol}`, lang);
  return digits(pair.dollar ? `$${EN.format(cents)}` : `${EN.format(cents)} ${pair.symbol}`, lang);
}

/** A raw amount of the pair currency, as `amountText` says it. */
export function moneyText(raw: string, pair: Pair, lang: Lang): string {
  return amountText(unitsOf(raw, pair.decimals), pair, lang);
}

/** A share in basis points: 3200 → 32%, the half of a position → ½ (32 % in Ukrainian). */
export function shareText(bps: number, lang: Lang): string {
  if (bps === 5_000) return '½';
  const value = digits(String(Number((bps / 100).toFixed(2))), lang);
  return lang === 'uk' ? `${value} %` : `${value}%`;
}

/** The day of a card: 29 Oct, 14:05 · 29 жовт., 14:05. */
export function cardDateText(at: number, lang: Lang): string {
  return dateText(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, lang);
}

/** A pocket of the Review by name. */
export function pocketText(pocket: Pocket['pocket'], lang: Lang): string {
  const w = BERTH[lang];
  switch (pocket) {
    case 'curve':
      return w.pocketCurve;
    case 'graduation':
      return w.pocketGraduation;
    case 'surplus':
      return w.pocketSurplus;
    case 'lp':
      return w.pocketLp;
    default:
      return w.pocketTransferFee;
  }
}

/** What this claim does about a pocket, in two words. */
export function pocketStateText(state: Pocket['state'], lang: Lang): string {
  const w = BERTH[lang];
  switch (state) {
    case 'IN_CLAIM':
      return w.stateInClaim;
    case 'EMPTY':
      return w.stateEmpty;
    case 'BEFORE_DEX':
      return w.stateBeforeDex;
    case 'WAITING':
      return w.stateWaiting;
    case 'CLOSED':
      return w.stateClosed;
    case 'NOT_YOURS':
      return w.stateNotYours;
    case 'LATER':
      return w.stateLater;
    default:
      return w.stateUnread;
  }
}

/** A claim that stopped, in two short sentences at most: what happened, and whether anything left. */
export function claimFailureText(failure: ClaimFailure, wallet: string | null, lang: Lang): string {
  const w = BERTH[lang];
  switch (failure.code) {
    case CLAIM_CLOSED:
      return w.closed;
    case WALLET_REFUSED:
      return wallet ? w.failWallet(wallet) : w.failWalletPlain;
    case BUILD_AGED:
      return w.failAged;
    case BUILD_UNEXPECTED:
      return w.failUnexpected;
    case 'LAUNCH_NOTHING_TO_CLAIM':
      return w.failNothing;
    case 'RATE_LIMITED':
      return w.failRate;
    case 'LAUNCH_BUILD_USED':
      return w.failUsed;
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return w.failOtherBytes;
    case 'WALLET_MISMATCH':
      return w.failWalletChanged;
    case 'LAUNCH_SUBMIT_FAILED':
      return w.failRefused;
    case 'LAUNCH_PAUSED':
    case 'LAUNCH_UNAVAILABLE':
      return w.failPaused;
    default:
      return failure.stage === 'send' ? w.failNoAnswer : w.failOther;
  }
}
