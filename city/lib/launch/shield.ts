import type { LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import { launchPreset } from '../../../lib/core/venues/meteora-dbc/presets.ts';
import type { Network } from './engine.ts';
import { CITY_DEFAULT_PRESET, type CityPresetId } from './gate.ts';
import type { LaunchTower } from './towers.ts';

/**
 * The shielded launch: the city's launch is protected by default, and the
 * protection is a quiet default rather than a headline — bots pay 20 % falling to 1 % over the first 2 minutes on the
 * DBC fee scheduler, the creator holds nothing at birth that could be dumped, and the tower wears a halo. «Статут вежі»
 * (a treasury under rules) is not this: it is the headline only of agents' coins and raises for a project.
 *
 * The numbers are the engine's (`lib/core/venues/meteora-dbc/presets.ts`); this file only names which served preset the
 * shield is and refuses to claim it when the engine serves anything else. The preset, the schedule and the default on
 * mainnet change only — each is one line here, or one variable of the deployment.
 */
export const CITY_SHIELD = Object.freeze({
  /** The engine's preset the shield launches on: Classic carries exactly the schedule below. */
  preset: 'classic' as CityPresetId,
  /** The DBC fee scheduler the shield needs: bots pay `startBps`, falling to `endBps` over `seconds`. */
  sniperFee: Object.freeze({ startBps: 2_000, endBps: 100, seconds: 120 }),
});

/**
 * False: the shield opens on the devnet stand only; on mainnet
 * the city keeps its current default. Flipped here, after the devnet pass.
 */
export const CITY_SHIELD_MAINNET = true; // Fork 24/24, devnet 25/25

/**
 * The deployment's switch: the shield opens only where `NEXT_PUBLIC_RYNTRA_CITY_SHIELD=open`. Anything else keeps the
 * city exactly as it was — the same default preset, the same «Bot shield» switch, no halo — without a code change.
 */
export const CITY_SHIELD_SWITCH = process.env.NEXT_PUBLIC_RYNTRA_CITY_SHIELD === 'open';

/** Whether the shield is open on the network the engine serves: the switch is open, and the network is allowed. */
export function cityShieldOpen(network: Network | null, ownerWord: boolean = CITY_SHIELD_MAINNET, switchOpen: boolean = CITY_SHIELD_SWITCH): boolean {
  if (!switchOpen) return false;
  return network === 'solana:devnet' || (network === 'solana:mainnet' && ownerWord);
}

/** The preset the sheet opens on: the shield's where it is open, the city's default elsewhere. */
export function cityStartPreset(network: Network | null, open: boolean = cityShieldOpen(network)): CityPresetId {
  return open ? CITY_SHIELD.preset : CITY_DEFAULT_PRESET;
}

type Schedule = Readonly<{ startBps: number; endBps: number; seconds: number }>;

/** The served preset is the shield, number for number: its id and exactly the shield's schedule. */
export function shieldServed(preset: Pick<LaunchPresetView, 'id' | 'sniperFee'> | null): boolean {
  if (!preset || preset.id !== CITY_SHIELD.preset) return false;
  const want = CITY_SHIELD.sniperFee;
  return preset.sniperFee.startBps === want.startBps && preset.sniperFee.endBps === want.endBps && preset.sniperFee.seconds === want.seconds;
}

/** A schedule at least as hard on bots as the shield's: it starts as high or higher, falls as low or lower, as late or later. */
export function shieldsBots(fee: Schedule | null | undefined): boolean {
  if (!fee) return false;
  const want = CITY_SHIELD.sniperFee;
  return fee.startBps >= want.startBps && fee.endBps <= want.endBps && fee.seconds >= want.seconds;
}

/**
 * The creator holds nothing at birth that could be dumped: their first purchase is under the creator's lock (Met Lock,
 * nobody can cancel it), or there was none — a launch from the city buys nothing, and a flow read whole says the
 * creator's wallet bought nothing here. A fact not read is not taken for one.
 */
export function creatorVests(launch: Pick<LaunchTower, 'mine' | 'flow' | 'creatorLocked'>): boolean {
  if (launch.creatorLocked === true) return true;
  if (launch.mine) return true;
  return launch.flow?.creatorBoughtBps === 0;
}

/**
 * Whether a launch's tower wears the halo: the shield is open on its network; it is a launch of people (not Ryntra's own
 * check) that Ryntra did not take down; its preset makes bots pay at least the shield's schedule; the creator holds
 * nothing at birth to dump; and the creator has not sold. A sale puts the halo out. The halo says how the coin was
 * born — never that it is safe, verified or a good trade.
 */
export function towerHalo(launch: Pick<LaunchTower, 'network' | 'ryntraTest' | 'hidden' | 'preset' | 'mine' | 'flow' | 'creatorLocked' | 'creatorSold'>, open: boolean = cityShieldOpen(launch.network)): boolean {
  if (!open || launch.ryntraTest || launch.hidden) return false;
  if (!launch.preset || !shieldsBots(launchPreset(launch.preset)?.sniperFee)) return false;
  if (launch.creatorSold === true) return false;
  return creatorVests(launch);
}
