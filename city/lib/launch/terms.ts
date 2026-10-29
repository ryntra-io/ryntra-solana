import type { LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import { DBC_TOKEN_AUTHORITY, LAUNCH_PRESETS } from '../../../lib/core/venues/meteora-dbc/presets.ts';
import type { Network } from './engine.ts';
import { pct, sol, span, usd } from './format.ts';

/**
 * What a launch signs up to, in the city's words. Every figure is the preset the engine serves
 * (`GET /api/v1/launch/presets`); the coin's own rules — its name fixed for ever, its supply — come from the engine's
 * preset table. Nothing here is counted again or rounded into a promise.
 */

/** The creator's part of every trading fee on the curve: the engine's split, or — from an older engine — its share after Meteora's part. */
function creatorShare(preset: LaunchPresetView): string {
  return preset.terms ? pct(preset.terms.curveSplit.creatorBps) : `${preset.creatorTradingFeePct}% after Meteora's part`;
}

/** The three short lines under the fields. */
export function ruleLines(preset: LaunchPresetView): readonly string[] {
  return [
    `Bots pay ${pct(preset.sniperFee.startBps)} → ${pct(preset.sniperFee.endBps)} in the first ${span(preset.sniperFee.seconds)}`,
    `Liquidity locked forever at ${usd(preset.graduationMarketCapUsd)}`,
    `${creatorShare(preset)} of every trading fee is yours`,
  ];
}

export type ReviewRow = Readonly<{ id: 'fees' | 'yours' | 'pool' | 'forever' | 'cost' | 'network'; label: string; lines: readonly string[] }>;

/** The review, at most two lines a row. `costLamports` — the engine's simulated cost, once a build has said it. */
export function reviewRows(preset: LaunchPresetView, network: Network, costLamports: string | null = null): readonly ReviewRow[] {
  const table = LAUNCH_PRESETS[preset.id];
  const end = pct(preset.sniperFee.endBps);
  const yours = [`${creatorShare(preset)} of every trading fee, from the first trade.`];
  if (preset.graduationFee.creatorPct > 0) yours.push(`${preset.graduationFee.creatorPct}% of the ${preset.graduationFee.pct}% fee when it moves to the pool.`);
  const pool = ['Moves to a Meteora pool. Liquidity locked forever.'];
  if (preset.terms && preset.terms.pool.creatorPositionBps > 0) pool.push(`Your locked part earns up to ${pct(preset.terms.pool.creatorPositionBps)} of the pool’s fees.`);
  const cost =
    costLamports !== null
      ? [`${sol(costLamports)} SOL of rent and fee, simulated by Solana.`]
      : [table.poolCreationFeeLamports === 0 ? 'No launch fee, only Solana’s rent and fee in SOL.' : 'Solana’s rent and fee, in SOL.', 'Your wallet shows the exact SOL before you sign.'];
  return [
    {
      id: 'fees',
      label: 'Fees',
      lines: [`Bots pay ${pct(preset.sniperFee.startBps)} → ${end} in the first ${span(preset.sniperFee.seconds)}.`, table.dynamicFee ? `Then ${end} a trade, more when the price swings.` : `Then ${end} a trade.`],
    },
    { id: 'yours', label: 'Yours', lines: yours },
    { id: 'pool', label: `At ${usd(preset.graduationMarketCapUsd)}`, lines: pool },
    {
      id: 'forever',
      label: 'Forever',
      lines: [
        table.token.authority === DBC_TOKEN_AUTHORITY.IMMUTABLE ? 'Name, ticker and picture can never be changed.' : 'Name, ticker and picture are written into the coin.',
        `${table.token.supply.toLocaleString('en-US')} coins, and no one can mint more.`,
      ],
    },
    { id: 'cost', label: 'You pay', lines: cost },
    { id: 'network', label: 'Network', lines: [network === 'solana:devnet' ? 'Solana devnet: test coins, no real money.' : 'Solana mainnet.'] },
  ];
}
