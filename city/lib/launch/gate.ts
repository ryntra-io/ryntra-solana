import type { LaunchPresetsResponse, LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import type { Network } from './engine.ts';

/** The presets the city launches on, in order: Protected first, where bots pay the most at the start, then Classic. */
export const CITY_PRESETS = ['protected', 'classic'] as const;

/**
 * False: the city launches on the devnet stand only, and on
 * mainnet its Launch district says it opens soon. The dock, the sheet and the flow all read this one value.
 */
export const CITY_LAUNCH_MAINNET = false;

/**
 * The deployment's switch for people: Launch in the city opens only where `NEXT_PUBLIC_RYNTRA_CITY_LAUNCH=open`.
 * Anything else keeps the dock's Launch on «opens soon» on every network, without a code change.
 */
export const CITY_LAUNCH_SWITCH = process.env.NEXT_PUBLIC_RYNTRA_CITY_LAUNCH === 'open';

/** Whether the city may launch on the network the engine serves: the switch is open, and the network is allowed. */
export function cityLaunchOpen(network: Network | null, ownerWord: boolean = CITY_LAUNCH_MAINNET, switchOpen: boolean = CITY_LAUNCH_SWITCH): boolean {
  if (!switchOpen) return false;
  return network === 'solana:devnet' || (network === 'solana:mainnet' && ownerWord);
}

/**
 * The preset the city's three fields launch on, as the engine describes it: one people may launch on, whose first
 * purchase is optional — the city's launch buys nothing, so it never needs the creator's lock.
 */
export function cityPreset(presets: Pick<LaunchPresetsResponse, 'presets'> | null): LaunchPresetView | null {
  for (const id of CITY_PRESETS) {
    const preset = presets?.presets.find((entry) => entry.id === id && !entry.technicalValidation && entry.creatorLockMinDays === null);
    if (preset) return preset;
  }
  return null;
}
