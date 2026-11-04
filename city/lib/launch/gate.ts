import type { LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import type { Network } from './engine.ts';

/** The two presets the city launches on: Classic, and Protected — where bots pay the most at the start. */
export const CITY_PRESETS = ['classic', 'protected'] as const;
export type CityPresetId = (typeof CITY_PRESETS)[number];

/**
 * The preset the sheet opens on; the other is one switch away in the review («Bot shield»). The strategy of 29.10 makes
 * Classic the default with Protected opt-in — that flip waits for the operator's confirmation and is this one line:
 * `'classic'`. Until then the city keeps launching on Protected first, as it did.
 */
export const CITY_DEFAULT_PRESET: CityPresetId = 'protected';

/**
 * Given (CITY-163). False would keep the city on the devnet stand,
 * and its Launch district on mainnet saying it opens soon; the dock, the sheet and the flow all read this one value.
 */
export const CITY_LAUNCH_MAINNET = true;

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

export type CityPresets = Readonly<Record<CityPresetId, LaunchPresetView | null>>;

/**
 * The city's presets as the engine describes them: each one people may launch on, whose first purchase is optional —
 * the city's launch buys nothing, so it never needs the creator's lock. A preset the engine does not serve so is null.
 */
export function cityPresets(presets: Readonly<{ presets: readonly LaunchPresetView[] }> | null): CityPresets {
  const of = (id: CityPresetId) => presets?.presets.find((entry) => entry.id === id && !entry.technicalValidation && entry.creatorLockMinDays === null) ?? null;
  return { classic: of('classic'), protected: of('protected') };
}

/** The preset a launch goes on: the one asked for, or the other when the engine does not serve it; null with neither. */
export function cityPreset(presets: Readonly<{ presets: readonly LaunchPresetView[] }> | null, choice: CityPresetId = CITY_DEFAULT_PRESET): LaunchPresetView | null {
  const served = cityPresets(presets);
  return served[choice] ?? served[choice === 'classic' ? 'protected' : 'classic'];
}
