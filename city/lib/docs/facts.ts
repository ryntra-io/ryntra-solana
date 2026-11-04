import { RULE_MAXIMUM_USD, RULE_MINIMUM_USD } from '../../../lib/autoinvest/limits.ts';
import { FEE_POLICY_V2, TRENDING_MIN_AGE_MS } from '../../../lib/core/fee-policy.ts';
import { presetTerms } from '../../../lib/core/launch/preset-terms.ts';
import { DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT, TRIGGER_V1_MIN_ORDER_USD } from '../../../lib/solana/limits/model.ts';
import { RYNTRA_SERVICE_FEE_POLICY } from '../../../lib/swap/service-fee.ts';
import { LIMIT_CEILING_USD } from '../earn/limit-gate.ts';
import { PIER_MIN_LAMPORTS } from '../earn/pier.ts';
import { PIER_CEILING_USD } from '../earn/pier-gate.ts';
import type { Lang } from '../i18n/langs.ts';
import { CITY_DEFAULT_PRESET, type CityPresetId } from '../launch/gate.ts';
import { PARTNER_TERMS, type PartnerTerms } from '../partners/terms.ts';

/**
 * Every figure the documentation prints, read from the module the product charges, splits or limits by (CITY-180). The
 * sections hold no number of their own — `docs.test.mjs` refuses a percent or a dollar figure typed into their source — so a
 * fee that changes in its table reads differently here on the next release, and a test keeps the two equal. This file only
 * adds the arithmetic from basis points to what a reader sees.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type DocsFacts = Readonly<{
  fees: Readonly<{ meme: number; trending: number; major: number; stable: number; stock: number; otherStock: number; unread: number }>;
  trendingDays: number;
  bridgeBps: number;
  limitMinUsd: number;
  recurringMinUsd: number;
  recurringMaxUsd: number;
  launch: Readonly<{
    feeBps: number;
    startCapUsd: number;
    graduationCapUsd: number;
    supply: number;
    creationFree: boolean;
    split: Readonly<{ creator: number; ryntra: number; meteora: number }>;
    splitThroughRyntra: Readonly<{ creator: number; ryntra: number; meteora: number }>;
    bots: Readonly<Record<CityPresetId, Readonly<{ startBps: number; endBps: number; minutes: number }>>>;
    defaultPreset: CityPresetId;
    graduationFeeBps: number;
    graduationCreatorBps: number;
    graduationRyntraBps: number;
    liquidityCreatorPct: number;
    poolStartFeeBps: number;
    poolEndFeeBps: number;
    poolPriceMultiple: number;
    poolDays: number;
    poolCreatorBps: number;
  }>;
  earn: Readonly<{ pierMinSol: number; pierCeilingUsd: number; limitCeilingUsd: number; makerSharePct: number }>;
  partners: PartnerTerms;
}>;

function terms(id: CityPresetId) {
  const found = presetTerms(id);
  if (!found) throw new Error(`no launch preset ${id}`);
  return found;
}

export function docsFacts(): DocsFacts {
  const own = terms(CITY_DEFAULT_PRESET);
  const bots = (id: CityPresetId) => {
    const fee = terms(id).curve.sniperFee;
    return { startBps: fee.startBps, endBps: fee.endBps, minutes: fee.seconds / 60 };
  };
  const shares = (s: Readonly<{ creatorBps: number; ryntraBps: number; meteoraBps: number }>) => ({ creator: s.creatorBps, ryntra: s.ryntraBps, meteora: s.meteoraBps });
  return {
    fees: {
      meme: FEE_POLICY_V2.MEME.bps,
      trending: FEE_POLICY_V2.TRENDING.bps,
      major: FEE_POLICY_V2.MAJOR.bps,
      stable: FEE_POLICY_V2.STABLE.bps,
      stock: FEE_POLICY_V2.XSTOCK.bps,
      otherStock: FEE_POLICY_V2.ONDO.bps,
      unread: FEE_POLICY_V2.AS_NOW.bps,
    },
    trendingDays: TRENDING_MIN_AGE_MS / DAY_MS,
    bridgeBps: RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE,
    limitMinUsd: TRIGGER_V1_MIN_ORDER_USD,
    recurringMinUsd: RULE_MINIMUM_USD,
    recurringMaxUsd: RULE_MAXIMUM_USD,
    launch: {
      feeBps: own.curve.baseFeeBps,
      startCapUsd: own.curve.startMarketCapUsd,
      graduationCapUsd: own.curve.graduationMarketCapUsd,
      supply: own.token.supply,
      creationFree: own.creationFeeLamports === 0,
      split: shares(own.curve.split),
      splitThroughRyntra: shares(own.curve.splitThroughRyntra),
      bots: { classic: bots('classic'), protected: bots('protected') },
      defaultPreset: CITY_DEFAULT_PRESET,
      graduationFeeBps: own.graduation.feeBps,
      graduationCreatorBps: own.graduation.creatorBps,
      graduationRyntraBps: own.graduation.ryntraBps,
      liquidityCreatorPct: own.exitLiquidity.creatorPct,
      poolStartFeeBps: own.pool.startFeeBps,
      poolEndFeeBps: own.pool.endFeeBps,
      poolPriceMultiple: own.pool.priceMultiple,
      poolDays: own.pool.expiresAfterSeconds / (DAY_MS / 1000),
      poolCreatorBps: own.pool.creatorPositionBps,
    },
    earn: {
      pierMinSol: Number(PIER_MIN_LAMPORTS) / 1e9,
      pierCeilingUsd: PIER_CEILING_USD['meteora-dlmm']!,
      limitCeilingUsd: LIMIT_CEILING_USD,
      makerSharePct: DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT,
    },
    partners: PARTNER_TERMS,
  };
}

/** The figures as a language writes them. The sections call only these. */
export type Say = Readonly<{
  /** Basis points as a percent: 25 → «0.25%», «0,25 %». */
  pct: (bps: number) => string;
  /** A whole percent as a reader sees it: 50 → «50%», «50 %». */
  whole: (percent: number) => string;
  /** Dollars: $5, $1,000, in Ukrainian $1 000. */
  usd: (value: number) => string;
  /** A large figure the way a page reads it: $75k, $75 тис. */
  usdShort: (value: number) => string;
  /** A plain number: 1,000,000,000; 1 000 000 000. */
  count: (value: number) => string;
  /** A share as a decimal figure: 0.05, 0,05. */
  decimal: (value: number) => string;
}>;

export function sayIn(lang: Lang): Say {
  const uk = lang === 'uk';
  const locale = uk ? 'uk-UA' : 'en-US';
  const percent = (value: number) => {
    const text = String(Math.round(value * 100) / 100);
    return uk ? `${text.replace('.', ',')} %` : `${text}%`;
  };
  const count = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  return {
    pct: (bps) => percent(bps / 100),
    whole: (value) => percent(value),
    usd: (value) => `$${count(value)}`,
    usdShort: (value) => {
      if (value < 1000) return `$${count(value)}`;
      const thousands = String(Math.round((value / 1000) * 10) / 10);
      return uk ? `$${thousands.replace('.', ',')} тис.` : `$${thousands}k`;
    },
    count,
    decimal: (value) => (uk ? String(value).replace('.', ',') : String(value)),
  };
}
