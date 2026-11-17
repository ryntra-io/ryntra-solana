/**
 * Native staking: the stake accounts a wallet may withdraw from or delegate, as positions.
 *
 * Found by two indexed reads of the stake program (`getProgramAccounts`, `jsonParsed`): the accounts whose
 * `authorized.staker` is the wallet (bytes 12–44 of the account) and those whose `authorized.withdrawer` is (bytes
 * 44–76); one account in both lists is one position. What it is worth is the account's lamports — what a withdraw
 * gives back, the rent reserve with it.
 *
 * Whether one step takes it out is the stake program's own rule:
 *
 * - not delegated (`initialized`), or delegated and its deactivation epoch is past — withdrawn now, one step;
 * - delegated and active (deactivation epoch `u64::MAX`) — deactivated first; free after the epoch ends;
 * - deactivating (the epoch has not passed) — withdrawn from the next epoch;
 * - a lockup in force (a time or an epoch ahead, and a custodian other than the wallet) — not before it ends;
 * - the wallet is the staker only — it may deactivate, never withdraw.
 *
 * Earned is not shown: the account keeps no record of what was first delegated.
 *
 * Pure: the parsed accounts, the epoch and the time in; positions out.
 */

import { NATIVE_SOL_MINT, STAKE_PROGRAM, exitBlocked, exitWhole, rawText, refs, type PortfolioExit, type PortfolioPosition } from "./model.ts";

/** `u64::MAX` — the deactivation epoch of a stake that has never been deactivated. */
export const NEVER_DEACTIVATED = "18446744073709551615";

/** The byte offsets the indexed reads filter on: `Meta.authorized.staker` and `.withdrawer`. */
export const STAKER_OFFSET = 12;
export const WITHDRAWER_OFFSET = 44;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

function intOf(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d{1,20}$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

export type StakeAccount = Readonly<{
  address: string;
  lamports: string;
  delegated: boolean;
  staker: string;
  withdrawer: string;
  /** The validator's vote account; null when not delegated. */
  voter: string | null;
  activationEpoch: bigint | null;
  deactivationEpoch: bigint | null;
  lockupUnix: bigint;
  lockupEpoch: bigint;
  custodian: string | null;
}>;

/** One entry of `getProgramAccounts` on the stake program, `jsonParsed`; null for anything that is not a stake account read whole. */
export function stakeAccountFrom(entry: unknown): StakeAccount | null {
  if (!isObject(entry)) return null;
  const address = text(entry.pubkey);
  const account = isObject(entry.account) ? entry.account : null;
  const lamports = account ? rawText(account.lamports) : null;
  const data = account && isObject(account.data) ? account.data : null;
  const parsed = data && isObject(data.parsed) ? data.parsed : null;
  const type = parsed ? text(parsed.type) : null;
  const info = parsed && isObject(parsed.info) ? parsed.info : null;
  const meta = info && isObject(info.meta) ? info.meta : null;
  const authorized = meta && isObject(meta.authorized) ? meta.authorized : null;
  const staker = authorized ? text(authorized.staker) : null;
  const withdrawer = authorized ? text(authorized.withdrawer) : null;
  if (!address || lamports === null || !meta || !staker || !withdrawer || (type !== "delegated" && type !== "initialized")) return null;
  const lockup = isObject(meta.lockup) ? meta.lockup : {};
  const stake = info && isObject(info.stake) ? info.stake : null;
  const delegation = stake && isObject(stake.delegation) ? stake.delegation : null;
  const delegated = type === "delegated" && delegation !== null;
  return {
    address,
    lamports,
    delegated,
    staker,
    withdrawer,
    voter: delegated ? text(delegation!.voter) : null,
    activationEpoch: delegated ? intOf(delegation!.activationEpoch) : null,
    deactivationEpoch: delegated ? intOf(delegation!.deactivationEpoch) : null,
    lockupUnix: intOf(lockup.unixTimestamp) ?? 0n,
    lockupEpoch: intOf(lockup.epoch) ?? 0n,
    custodian: text(lockup.custodian),
  };
}

/** Both indexed reads, one account once. */
export function stakeAccountsFrom(...lists: readonly unknown[]): StakeAccount[] {
  const byAddress = new Map<string, StakeAccount>();
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) {
      const account = stakeAccountFrom(entry);
      if (account && !byAddress.has(account.address)) byAddress.set(account.address, account);
    }
  }
  return [...byAddress.values()];
}

/**
 * How it leaves, by the stake program's rule. `epoch` is the chain's epoch now (null — not read: a deactivating stake is
 * then counted as still cooling); `nowUnix` the chain's or the server's time, seconds.
 */
export function stakeExit(account: StakeAccount, owner: string, epoch: bigint | null, nowUnix: bigint): PortfolioExit {
  const lockedByTime = account.lockupUnix > nowUnix;
  const lockedByEpoch = epoch === null ? account.lockupEpoch > 0n : account.lockupEpoch > epoch;
  const lockupHolds = (lockedByTime || lockedByEpoch) && account.custodian !== owner;
  const active = account.delegated && (account.deactivationEpoch === null || account.deactivationEpoch.toString() === NEVER_DEACTIVATED);
  const cooling = account.delegated && !active && (epoch === null || account.deactivationEpoch! >= epoch);
  if (account.withdrawer !== owner) {
    return exitBlocked(active ? "stake-deactivate" : "none", "NOT_WITHDRAWER");
  }
  if (lockupHolds) {
    return exitBlocked(active ? "stake-deactivate" : "stake-withdraw", "STAKE_LOCKUP", {
      untilTime: lockedByTime ? new Date(Number(account.lockupUnix) * 1000).toISOString() : null,
      untilEpoch: lockedByEpoch ? Number(account.lockupEpoch) : null,
    });
  }
  if (active) return exitBlocked("stake-deactivate", "STAKE_ACTIVE", { untilEpoch: epoch === null ? null : Number(epoch) + 1 });
  if (cooling) return exitBlocked("stake-withdraw", "STAKE_COOLING", { untilEpoch: Number(account.deactivationEpoch!) + 1 });
  return exitWhole("stake-withdraw");
}

export function stakePositions(accounts: readonly StakeAccount[], owner: string, epoch: bigint | null, nowUnix: bigint, readAt: string): PortfolioPosition[] {
  return accounts
    .filter((account) => account.lamports !== "0")
    .map((account) => ({
      id: `native-stake:${account.address}`,
      protocol: "native-stake" as const,
      platform: null,
      kind: "stake" as const,
      state: "read" as const,
      origin: "chain" as const,
      label: "SOL",
      value: { usd: null, sol: null },
      earned: null,
      tokens: [{ mint: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, amountRaw: account.lamports, usd: null, role: "held" as const }],
      inRange: null,
      exit: stakeExit(account, owner, epoch, nowUnix),
      /* `market` names the validator's vote account: where the stake is delegated. */
      refs: refs({ program: STAKE_PROGRAM, position: account.address, market: account.voter }),
      readAt,
    }));
}
