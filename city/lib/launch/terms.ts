import type { LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import { DBC_TOKEN_AUTHORITY, LAUNCH_PRESETS } from '../../../lib/core/venues/meteora-dbc/presets.ts';
import type { Network } from './engine.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import { pct, sol, span, usd } from './format.ts';
import { TERMS_WORDS } from './words.ts';

/**
 * What a launch signs up to, in the city's words. Every figure is the preset the engine serves
 * (`GET /api/v1/launch/presets`); the coin's own rules — its name fixed for ever, its supply — come from the engine's
 * preset table. Nothing here is counted again or rounded into a promise.
 */

/** The creator's part of every trading fee on the curve: the engine's split, or — from an older engine — its share after Meteora's part. */
function creatorShare(preset: LaunchPresetView): string {
  return preset.terms ? pct(preset.terms.curveSplit.creatorBps) : wordsNow(TERMS_WORDS).afterMeteora(digits(String(preset.creatorTradingFeePct)));
}

/** The three short lines under the fields. */
export function ruleLines(preset: LaunchPresetView): readonly string[] {
  const w = wordsNow(TERMS_WORDS);
  return [
    w.ruleBots(pct(preset.sniperFee.startBps), pct(preset.sniperFee.endBps), span(preset.sniperFee.seconds)),
    w.ruleLocked(usd(preset.graduationMarketCapUsd)),
    w.ruleYours(creatorShare(preset)),
  ];
}

export type ReviewRow = Readonly<{ id: 'fees' | 'yours' | 'pool' | 'forever' | 'cost' | 'network'; label: string; lines: readonly string[] }>;

/** The review, at most two lines a row. `costLamports` — the engine's simulated cost, once a build has said it. */
export function reviewRows(preset: LaunchPresetView, network: Network, costLamports: string | null = null): readonly ReviewRow[] {
  const w = wordsNow(TERMS_WORDS);
  const table = LAUNCH_PRESETS[preset.id];
  const end = pct(preset.sniperFee.endBps);
  const yours = [w.yoursFirst(creatorShare(preset))];
  if (preset.graduationFee.creatorPct > 0) yours.push(w.yoursMove(digits(String(preset.graduationFee.creatorPct)), digits(String(preset.graduationFee.pct))));
  const pool = [w.poolMoves];
  if (preset.terms && preset.terms.pool.creatorPositionBps > 0) pool.push(w.poolEarns(pct(preset.terms.pool.creatorPositionBps)));
  const cost = costLamports !== null ? [w.costSimulated(sol(costLamports))] : [table.poolCreationFeeLamports === 0 ? w.costNoFee : w.costRent, w.costExact];
  return [
    {
      id: 'fees',
      label: w.fees,
      lines: [w.feesBots(pct(preset.sniperFee.startBps), end, span(preset.sniperFee.seconds)), table.dynamicFee ? w.feesThenSwing(end) : w.feesThen(end)],
    },
    { id: 'yours', label: w.yours, lines: yours },
    { id: 'pool', label: w.poolAt(usd(preset.graduationMarketCapUsd)), lines: pool },
    {
      id: 'forever',
      label: w.forever,
      lines: [table.token.authority === DBC_TOKEN_AUTHORITY.IMMUTABLE ? w.foreverFixed : w.foreverWritten, w.supply(Number(table.token.supply))],
    },
    { id: 'cost', label: w.youPay, lines: cost },
    { id: 'network', label: w.network, lines: [network === 'solana:devnet' ? w.devnet : w.mainnet] },
  ];
}
