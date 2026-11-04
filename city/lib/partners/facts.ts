import { FEE_POLICY_V2, type FeeFlow } from '../../../lib/core/fee-policy.ts';
import { presetTerms } from '../../../lib/core/launch/preset-terms.ts';
import { PARTNER_TERMS, type PartnerTerms } from './terms.ts';

/**
 * «Ryntra Partners» (CITY-126) as the city reads it. The partner's terms are the operator's — decision 93, in
 * `city/lib/partners/terms.ts`, the one place the partner page `/partners` reads them from too — so the city and the
 * page never say two different numbers. Ryntra's fees come from the fee policy, a creator's share from the launch
 * preset's terms; nothing here is typed by hand and nothing here pays. The creator partner's share (D-P1) is still the
 * Owner's to decide and is not drawn. No React, no three.js: the tests run it in Node.
 */

/** The partner's offer as the window prints it, in per cent and days; null while the terms are not set. */
export type Offer = Readonly<{
  /** The partner's share of Ryntra's fee for each brought person's first days. */
  firstPercent: number;
  firstDays: number;
  /** The share after those days. */
  afterPercent: number;
  /** A person stays with the partner who brought them for good. */
  lifetime: boolean;
  /** The discount on Ryntra's fee for the person a partner brings. */
  discountPercent: number;
  minimumUsd: number;
  asset: string;
  levels: number;
}>;

export function offerOf(terms: PartnerTerms): Offer | null {
  const { share, refereeDiscountBps, minimumPayoutUsd, payoutAsset, levels, attribution } = terms;
  if (!share || refereeDiscountBps === null || minimumPayoutUsd === null || !payoutAsset || levels === null || attribution === null) return null;
  return {
    firstPercent: share.firstBps / 100,
    firstDays: share.firstDays,
    afterPercent: share.afterBps / 100,
    lifetime: attribution === 'lifetime',
    discountPercent: refereeDiscountBps / 100,
    minimumUsd: minimumPayoutUsd,
    asset: payoutAsset,
    levels,
  };
}

export const OFFER: Offer | null = offerOf(PARTNER_TERMS);

/**
 * Where payouts stand. A partner's share is counted from today and paid once the revenue ledger runs (PRT-2): until
 * then nothing is claimable. The day it runs this turns `open` in the same change as that row.
 */
export const PAYOUTS: 'counting' | 'open' = 'counting';

/** A per cent as the language writes it — `40%`, `40 %`, `0,32 %` — as the partner deck prints it. */
export function percent(value: number, lang: 'en' | 'uk'): string {
  const text = String(Number(value.toFixed(2)));
  return lang === 'uk' ? `${text.replace('.', ',')} %` : `${text}%`;
}

/* -------------------------------------------------------------- the mixes */

export const MIX_IDS = ['majors', 'mixed', 'memes'] as const;
export type MixId = (typeof MIX_IDS)[number];

/**
 * What a friend's trading is made of, in per cent of volume by the fee policy's flows. The weights are the model's;
 * the rates come from `FEE_POLICY_V2` alone.
 */
export const MIXES: Readonly<Record<MixId, Readonly<Partial<Record<FeeFlow, number>>>>> = {
  majors: { MAJOR: 80, TRENDING: 5, STABLE: 15 },
  mixed: { MAJOR: 35, TRENDING: 15, MEME: 25, STABLE: 25 },
  memes: { MAJOR: 20, TRENDING: 10, MEME: 60, STABLE: 10 },
};

/** Ryntra's fee per $1 000 a person trades in this mix, before any discount, in dollars: Σ share × the flow's rate. */
export function feePer1000(mix: MixId): number {
  let usd = 0;
  for (const [flow, weight] of Object.entries(MIXES[mix]) as [FeeFlow, number][]) usd += (weight / 100) * (FEE_POLICY_V2[flow].bps / 10_000) * 1_000;
  return Math.round(usd * 100) / 100;
}

/**
 * What Ryntra receives per $1 000 a brought person trades: the fee less the person's discount. The partner's share is a
 * share of this — of what Ryntra received, never of the person's money.
 */
export function receivedPer1000(mix: MixId, offer: Offer | null = OFFER): number {
  const discount = offer ? offer.discountPercent / 100 : 0;
  return Math.round(feePer1000(mix) * (1 - discount) * 100) / 100;
}

/* -------------------------------------------------------------- creators */

const CLASSIC = presetTerms('classic');
if (!CLASSIC) throw new Error('the Classic launch preset is missing');

/**
 * A creator's own coin, from the launch preset's terms (`lib/core/launch/preset-terms.ts`, the same the launch form and
 * the partner deck read): the curve's fee, the creator's share of every fee on the curve, and an example of the pool
 * after graduation — its floor fee and the creator's locked position's share of it.
 */
export const CREATOR = {
  curveFeePercent: CLASSIC.curve.baseFeeBps / 100,
  curveSharePercent: CLASSIC.curve.split.creatorBps / 100,
  poolFeePercent: CLASSIC.pool.endFeeBps / 100,
  poolSharePercent: CLASSIC.pool.creatorPositionBps / 100,
} as const;

/** The creator's share of the curve's volume, in per cent: the curve's fee × the creator's share of it — 1 % × 32 %. */
export const CREATOR_CURVE_PERCENT = Math.round(CREATOR.curveFeePercent * CREATOR.curveSharePercent * 100) / 10_000;

/** An example of the graduated pool, in per cent of its volume: its floor fee × the creator's locked position's share. */
export const CREATOR_POOL_PERCENT = Math.round(CREATOR.poolFeePercent * CREATOR.poolSharePercent * 100) / 10_000;

/** What a creator earns on `curveUsd` of curve volume and `poolUsd` of graduated pool volume, in dollars. */
export function creatorEarns(curveUsd: number, poolUsd: number): Readonly<{ curve: number; pool: number }> {
  const safe = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
  return { curve: safe(curveUsd) * (CREATOR_CURVE_PERCENT / 100), pool: safe(poolUsd) * (CREATOR_POOL_PERCENT / 100) };
}

/* ----------------------------------------------------------------- guild */

/** The guild's roles, on the badges the city already has. Its season, seats and pay are the operator's to set (D-P8). */
export const GUILD_ROLES = ['scout', 'builder', 'host', 'guide'] as const;
export type GuildRole = (typeof GUILD_ROLES)[number];

/* -------------------------------------------------------------- products */

/** The products a partner's share comes from (decision 93: launches and swaps): counted today, or still being built. */
export type ProductState = 'counting' | 'coming';
export type ProductId = 'swap' | 'launch';

export const PRODUCTS: readonly Readonly<{ id: ProductId; state: ProductState }>[] = [
  { id: 'swap', state: 'counting' },
  { id: 'launch', state: 'coming' },
];
