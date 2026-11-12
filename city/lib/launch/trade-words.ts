import type { Lang } from '../i18n/langs.ts';
import { clock, type FeeEarner, type FeeNow, type Progress, type Review } from './trade.ts';
import { BUILD_AGED, BUILD_UNEXPECTED, TRADE_CLOSED, WALLET_REFUSED, type TradeFailure } from './trade-flow.ts';
import { LAUNCH_TRADE } from './words.ts';

/**
 * How Buy and Sell on a launch's tower say the engine's figures, in the language on screen (CITY-79): figures to receive
 * rounded down, figures to pay rounded up, so neither ever reads better than it is. The words are `LAUNCH_TRADE`.
 */

type W = (typeof LAUNCH_TRADE)['en'];

const decimal = (text: string, lang: Lang) => (lang === 'uk' ? text.replace('.', ',') : text);

/** A share in basis points: 1400 → 14%, 50 → 0.5% (14 %, 0,5 % in Ukrainian). */
export function pctText(bps: number, lang: Lang): string {
  const value = decimal(String(Number((bps / 100).toFixed(2))), lang);
  return lang === 'uk' ? `${value} %` : `${value}%`;
}

/** A fee to pay, short: one decimal from 1% up, rounded up, so it never reads as less than it is (947 → 9.5%). */
export function feePctText(bps: number, lang: Lang): string {
  return pctText(bps >= 100 ? Math.ceil(bps / 10) * 10 : bps, lang);
}

/** An amount of a coin, short: 12.4M, 3.2K, 25.00, 0.0042. `down` for what one receives, `up` for what one pays. */
export function unitsText(value: number, round: 'down' | 'up', lang: Lang): string {
  const cut = (n: number, places: number) => {
    const f = 10 ** places;
    return (round === 'down' ? Math.floor(n * f + 1e-9) : Math.ceil(n * f - 1e-9)) / f;
  };
  const scaled = (n: number, unit: number, mark: string) => `${cut(n / unit, n / unit >= 100 ? 0 : 1)}${mark}`;
  let text: string;
  if (value >= 1e9) text = scaled(value, 1e9, 'B');
  else if (value >= 1e6) text = scaled(value, 1e6, 'M');
  else if (value >= 1e4) text = scaled(value, 1e3, 'K');
  else if (value >= 1) text = cut(value, 2).toFixed(2);
  else if (value === 0) text = '0';
  else {
    // Written out in full (CITY-243): `String` writes anything under a millionth as «3.7e-7», which read «$3,7E-7» in
    // «My tower». Two figures after the leading zeros, down to twelve places.
    const places = Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(value))));
    text = cut(value, places).toFixed(places).replace(/\.?0+$/, '');
  }
  return decimal(text, lang);
}

/** Dollars, short: $34.5K, $75K, $1.25M. */
export function dollarsText(value: number, lang: Lang): string {
  let text: string;
  if (value >= 1e6) text = `$${Number((value / 1e6).toFixed(2))}M`;
  else if (value >= 1e3) text = `$${Number((value / 1e3).toFixed(value >= 1e4 ? 1 : 2))}K`;
  else text = `$${Math.round(value)}`;
  return decimal(text, lang);
}

/** «Launch fee now 14% → 1% in 0:48», or the fee now once it has fallen, or the pool's. */
export function feeLineText(fee: FeeNow, lang: Lang): string {
  const w = LAUNCH_TRADE[lang];
  if (fee.endBps !== null && fee.leftS !== null) return w.feeFalling(feePctText(fee.nowBps, lang), feePctText(fee.endBps, lang), clock(fee.leftS));
  return fee.venue === 'pool' ? w.poolFeeNow(feePctText(fee.nowBps, lang)) : w.feeNow(feePctText(fee.nowBps, lang));
}

/** «To DEX: 46% · $34.5K of $75K», or «Graduated · DAMM v2». */
export function progressText(progress: Progress, lang: Lang): string {
  const w = LAUNCH_TRADE[lang];
  if (progress.migrated) return progress.jupiter ? w.graduatedJupiter : w.graduated;
  const pct = pctText(progress.pct * 100, lang);
  if (progress.capUsd === null || progress.graduationUsd === null) return w.toDexPlain(pct);
  return w.toDex(pct, dollarsText(progress.capUsd, lang), dollarsText(progress.graduationUsd, lang));
}

/** The one line before signing: the fee and the least it lands with. The risk sentence stands beside it. */
export function honestText(review: Review, pairSymbol: string, lang: Lang): string {
  return LAUNCH_TRADE[lang].honest(`${unitsText(review.fee, 'up', lang)} ${pairSymbol}`, `${unitsText(review.minimum, 'down', lang)} ${review.getSymbol}`);
}

/**
 * The risk beside the one line, by the engine's verdict over this very trade (`tradeRisk` of the quote): the check
 * that stops it, the check that asks for a look, or the plain truth of new coins.
 */
export function riskText(verdict: string | null, lang: Lang): string {
  const w = LAUNCH_TRADE[lang];
  return verdict === 'BLOCKED' ? w.riskBlocked : verdict === 'REVIEW_REQUIRED' ? w.riskReview : w.risk;
}

/** What the quote gets and how far it moves the price: «≈ 12.4M KITE · price +2.4%». */
export function getText(review: Review, lang: Lang): string {
  const move = `${review.priceMoveBps >= 0 ? '+' : '−'}${pctText(Math.abs(review.priceMoveBps), lang)}`;
  return LAUNCH_TRADE[lang].youGet(`${unitsText(review.get, 'down', lang)} ${review.getSymbol}`, move);
}

/** Who earns a share of the fee, by the dictionary's word for it. */
export function earnerText(who: FeeEarner, lang: Lang): string {
  return LAUNCH_TRADE[lang][who satisfies keyof W];
}

/** A trade that stopped, in two short sentences at most: what happened, and whether anything left. */
export function tradeFailureText(failure: TradeFailure, wallet: string | null, lang: Lang): string {
  const w = LAUNCH_TRADE[lang];
  switch (failure.code) {
    case TRADE_CLOSED:
      return w.closed;
    case WALLET_REFUSED:
      return wallet ? w.failWallet(wallet) : w.failWalletPlain;
    case BUILD_AGED:
      return w.failAged;
    case BUILD_UNEXPECTED:
      return w.failUnexpected;
    case 'LAUNCH_BALANCE_LOW':
      return w.failBalance;
    case 'LAUNCH_GRADUATING':
      return w.failGraduating;
    case 'LAUNCH_SLIPPAGE':
      return w.failSlippage;
    case 'RATE_LIMITED':
      return w.failRate;
    case 'WALLET_MISMATCH':
      return w.failWalletChanged;
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return w.failOtherBytes;
    case 'LAUNCH_BUILD_USED':
      return w.failUsed;
    case 'LAUNCH_SUBMIT_FAILED':
      return w.failRefused;
    case 'LAUNCH_UNAVAILABLE':
      return w.failUnavailable;
    default:
      return failure.stage === 'send' ? w.failNoAnswer : w.failOther;
  }
}
