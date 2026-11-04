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

export type ReviewRow = Readonly<{ id: 'line' | 'fees' | 'halo' | 'yours' | 'pool' | 'forever' | 'route' | 'cost' | 'network'; label: string; lines: readonly string[] }>;

/**
 * The one line before the signature (CITY-143), in parts the sheet joins with « · »: the fee after the bots' window, who
 * receives it, the move to the DEX, and the risk. The split is the one of a trade through Ryntra — the city trades a
 * launch through Ryntra's own route (`curveSplitThroughRyntra`); another app's route is the review's «route» row, behind
 * «i». From an engine without the split, only the creator's share is said.
 */
function lineParts(preset: LaunchPresetView): readonly string[] {
  const w = wordsNow(TERMS_WORDS);
  const parts = [w.lineFee(pct(preset.sniperFee.endBps))];
  const split = preset.terms?.curveSplitThroughRyntra;
  if (split) parts.push(w.lineYou(pct(split.creatorBps)), w.lineRyntra(pct(split.ryntraBps)), w.lineMeteora(pct(split.meteoraBps)));
  else parts.push(w.lineYou(creatorShare(preset)));
  const exit = preset.terms?.graduation;
  if (exit && exit.feeBps > 0) {
    /* Where Ryntra's part of the exit is the market's budget, it is not said as Ryntra's. */
    parts.push(exit.toBudget ? w.lineExitYou(pct(exit.feeBps), pct(exit.creatorBps)) : w.lineExit(pct(exit.feeBps), pct(exit.creatorBps), pct(exit.ryntraBps)));
  } else if (!exit && preset.graduationFee.pct > 0) {
    parts.push(w.lineExitYou(digits(`${preset.graduationFee.pct}%`), digits(`${preset.graduationFee.creatorPct}%`)));
  }
  parts.push(w.lineRisk);
  return parts;
}

/** The split of a trade through another app, when it differs from the one through Ryntra the line says. */
function routeLines(preset: LaunchPresetView): readonly string[] | null {
  const terms = preset.terms;
  if (!terms) return null;
  const other = terms.curveSplit;
  const ours = terms.curveSplitThroughRyntra;
  if (other.creatorBps === ours.creatorBps && other.ryntraBps === ours.ryntraBps && other.meteoraBps === ours.meteoraBps) return null;
  const w = wordsNow(TERMS_WORDS);
  return [w.routeSplit(pct(other.creatorBps), pct(other.ryntraBps), pct(other.meteoraBps)), w.routeWhen];
}

/**
 * The cost line, first on the sheet (CITY-143): no launch fee where the preset takes none, then the network's cost —
 * the engine's simulation once a build has said it («≈», rounded up), else only that the network takes its fee.
 */
export function costLine(preset: LaunchPresetView, costLamports: string | null = null): readonly [string, string] {
  const w = wordsNow(TERMS_WORDS);
  const free = LAUNCH_PRESETS[preset.id].poolCreationFeeLamports === 0;
  return [free ? w.costFree : w.costRentShort, costLamports !== null ? w.costNetwork(sol(costLamports)) : w.costNetworkOnly];
}

/** What bots pay at the start, as the bot shield's switch says it: «50% → 1% · 10 min». */
export function shieldLine(preset: LaunchPresetView): string {
  return wordsNow(TERMS_WORDS).shield(pct(preset.sniperFee.startBps), pct(preset.sniperFee.endBps), span(preset.sniperFee.seconds));
}

export type Fact = Readonly<{ id: 'dex' | 'locked'; label: string; value: string }>;

/** The two facts beside the line: where the coin moves to a DEX, and its liquidity locked for ever. */
export function launchFacts(preset: LaunchPresetView): readonly Fact[] {
  const w = wordsNow(TERMS_WORDS);
  return [
    { id: 'dex', label: w.factDex, value: usd(preset.graduationMarketCapUsd) },
    { id: 'locked', label: w.factLocked, value: w.factForever },
  ];
}

/**
 * The review: first the one line before the signature (its parts), then the rows behind «i», at most two lines a row.
 * `costLamports` — the engine's simulated cost, once a build has said it; `halo` — the launch goes on the shield
 * (CITY-169, `shield.ts`), so «i» says what keeps the halo on its tower.
 */
export function reviewRows(preset: LaunchPresetView, network: Network, costLamports: string | null = null, halo = false): readonly ReviewRow[] {
  const w = wordsNow(TERMS_WORDS);
  const table = LAUNCH_PRESETS[preset.id];
  const end = pct(preset.sniperFee.endBps);
  const yours = [w.yoursFirst(creatorShare(preset))];
  if (preset.graduationFee.creatorPct > 0) yours.push(w.yoursMove(digits(String(preset.graduationFee.creatorPct)), digits(String(preset.graduationFee.pct))));
  const pool = [w.poolMoves];
  if (preset.terms && preset.terms.pool.creatorPositionBps > 0) pool.push(w.poolEarns(pct(preset.terms.pool.creatorPositionBps)));
  const cost = costLamports !== null ? [w.costSimulated(sol(costLamports))] : [table.poolCreationFeeLamports === 0 ? w.costNoFee : w.costRent, w.costExact];
  const route = routeLines(preset);
  return [
    { id: 'line', label: w.beforeSign, lines: lineParts(preset) },
    {
      id: 'fees',
      label: w.fees,
      lines: [w.feesBots(pct(preset.sniperFee.startBps), end, span(preset.sniperFee.seconds)), table.dynamicFee ? w.feesThenSwing(end) : w.feesThen(end)],
    },
    ...(halo ? [{ id: 'halo' as const, label: w.halo, lines: [w.haloBirth, w.haloKeeps] }] : []),
    { id: 'yours', label: w.yours, lines: yours },
    { id: 'pool', label: w.poolAt(usd(preset.graduationMarketCapUsd)), lines: pool },
    {
      id: 'forever',
      label: w.forever,
      lines: [table.token.authority === DBC_TOKEN_AUTHORITY.IMMUTABLE ? w.foreverFixed : w.foreverWritten, w.supply(Number(table.token.supply))],
    },
    ...(route ? [{ id: 'route' as const, label: w.route, lines: route }] : []),
    { id: 'cost', label: w.youPay, lines: cost },
    { id: 'network', label: w.network, lines: [network === 'solana:devnet' ? w.devnet : w.mainnet] },
  ];
}
