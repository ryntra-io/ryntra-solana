import type { LaunchPresetsResponse } from '../../../lib/api/v1/contract.ts';
import { EARLY_ACCESS_TIMING, earlyAccessProblems, earlyAccessSchedule, type EarlyAccessBounds, type EarlyAccessRules } from '../../../lib/core/launch/early-access.ts';
import type { Network } from './engine.ts';

/**
 * «Your people first» — early access in the city's launch (CITY-212), the engine's Alpha Vault format (SOL-L5,
 * `lib/launch/early-access.server.ts`): the creator's people put USDC in for an hour before anyone else can trade, the
 * vault buys for all of them at one price, and public trading opens after. The creator says the goal — how much their
 * people may bring — and the city fills in the rest of the rules from the engine's own bounds; the engine checks them
 * again and builds every byte.
 *
 * A door behind two locks, both shut by default:
 * - the city's switch, `NEXT_PUBLIC_RYNTRA_CITY_EARLY_ACCESS=open` — closed unless a deployment opens it;
 * - the engine: it names the format's bounds only where the format is open (`formats.earlyAccess`). The city adds its own
 *   mainnet word on top (`CITY_EARLY_ACCESS_MAINNET`, false), so a mainnet engine that opened it would still find the
 *   city's door shut until the city is changed too.
 *
 * Pure and client-safe.
 */

export type EarlyBounds = NonNullable<NonNullable<NonNullable<LaunchPresetsResponse['formats']>['earlyAccess']>['bounds']>;

/** The creator's goal: how much their people may bring in, in US dollars. */
export type EarlyChoice = Readonly<{ capUsd: number }>;

/** The amounts the sheet offers; each shows only where the engine's bounds take it. */
export const EARLY_CAPS_USD = [1_000, 5_000, 25_000] as const;

/** The city's switch for people: closed unless the deployment opens it. */
export const CITY_EARLY_ACCESS_SWITCH = process.env.NEXT_PUBLIC_RYNTRA_CITY_EARLY_ACCESS === 'open';

/** The city's own word on mainnet: none. The engine's word is needed too; this one keeps the city shut whatever it says. */
export const CITY_EARLY_ACCESS_MAINNET = false;

/** Deposits open this long after the press: the three transactions land before the window opens. */
export const EARLY_LEAD_SECONDS = 5 * 60;
/** The window the creator's people have, where the bounds allow it. */
export const EARLY_WINDOW_SECONDS = 60 * 60;
/** The market cap the pool opens at, where the bounds allow it. */
export const EARLY_START_MARKET_CAP_USD = 50_000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampRaw = (value: bigint, min: bigint, max: bigint) => (value < min ? min : value > max ? max : value);

/** Whether the door shows: the city's switch is open, the engine names its bounds, and the network is the stand (or mainnet by both words). */
export function earlyDoorOpen(network: Network | null, bounds: EarlyBounds | null, switchOpen: boolean = CITY_EARLY_ACCESS_SWITCH, mainnetWord: boolean = CITY_EARLY_ACCESS_MAINNET): boolean {
  if (!switchOpen || !bounds) return false;
  return network === 'solana:devnet' || (network === 'solana:mainnet' && mainnetWord === true);
}

/**
 * The rules for a goal, at `now` (unix seconds), inside the engine's bounds: Pro Rata where offered — everyone in the
 * window buys at one price, the rest of each deposit comes back —, else first come with a fair cap per wallet; deposits
 * open in five minutes for an hour; nothing vests later than the bounds' least. Null when no rules inside the bounds
 * reach the goal: the sheet then does not offer it.
 */
export function earlyRules(choice: EarlyChoice, bounds: EarlyBounds, now: number): EarlyAccessRules | null {
  const mode = bounds.modes.includes('PRO_RATA') ? 'PRO_RATA' : bounds.modes.includes('FCFS') ? 'FCFS' : null;
  if (!mode || !Number.isFinite(choice.capUsd) || choice.capUsd <= 0) return null;
  const least = Math.max(bounds.minDepositMinutes * 60, EARLY_ACCESS_TIMING.minDepositSeconds);
  const window = clamp(EARLY_WINDOW_SECONDS, least, bounds.maxDepositHours * 3_600);
  const depositStartsAt = Math.floor(now) + Math.max(EARLY_LEAD_SECONDS, EARLY_ACCESS_TIMING.minLeadSeconds);
  const cap = clampRaw(BigInt(Math.round(choice.capUsd)) * 1_000_000n, BigInt(bounds.minCapRaw), BigInt(bounds.maxCapRaw));
  const perWallet = clampRaw(cap / 10n, BigInt(bounds.minIndividualCapRaw), cap);
  const rules: EarlyAccessRules = {
    mode,
    depositStartsAt,
    depositEndsAt: depositStartsAt + window,
    maxCapRaw: cap.toString(),
    individualCapRaw: mode === 'FCFS' ? perWallet.toString() : null,
    vestingHours: clamp(0, bounds.minVestingHours, bounds.maxVestingHours),
    startMarketCapUsd: clamp(EARLY_START_MARKET_CAP_USD, bounds.minStartMarketCapUsd, bounds.maxStartMarketCapUsd),
    supply: 1_000_000_000,
  };
  return earlyAccessProblems(rules, bounds as EarlyAccessBounds, Math.floor(now)).length ? null : rules;
}

/** The goals the sheet offers here: each amount whose rules hold inside the bounds. */
export function earlyCaps(bounds: EarlyBounds, now: number): readonly number[] {
  return EARLY_CAPS_USD.filter((capUsd) => earlyRules({ capUsd }, bounds, now) !== null);
}

/** When the creator's people get in, and when everyone may trade — unix seconds, from the rules the sheet would send. */
export function earlyTimes(rules: EarlyAccessRules): Readonly<{ opensAt: number; publicAt: number }> {
  const schedule = earlyAccessSchedule(rules);
  return { opensAt: schedule.depositStartsAt, publicAt: schedule.activatesAt };
}
