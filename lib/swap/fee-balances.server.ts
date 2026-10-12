/**
 * What has accrued and is not yet withdrawn — server only.
 *
 * Separate from everything else in this folder on purpose. A per-swap record
 * says what one operation produced; this says what is **sitting there**, and the
 * two answer different questions that a business has to be able to ask
 * independently. Adding up receipts is not the same as looking in the account,
 * and where the two disagree the account is right.
 *
 * Both readers are read-only and neither can move anything. Withdrawal is a
 * operator action with a wallet, at `relay.link/claim-app-fees` for Relay and by
 * transferring from the referral token account for Jupiter.
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@mayanfinance/swap-sdk";

import { RELAY_API_ORIGIN } from "../relay/chains.ts";
import { JUPITER_ULTRA_REFERRAL_PROJECT } from "../solana/referral-account.server.ts";
import { createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";

export type FeeBalance = Readonly<{
  mechanism: "JUPITER_REFERRAL" | "RELAY_APP_FEE";
  /** Mint on Solana, contract on an EVM chain. */
  asset: string;
  symbol: string | null;
  decimals: number | null;
  /**
   * Raw base units sitting in the account. **This is the gross**, not Ryntra's.
   *
   * The distinction is the whole reason `split` exists below. A Jupiter referral
   * token account holds the entire fee the person paid and the provider's share
   * comes out when the balance is claimed, so calling this figure "available to
   * Ryntra" would overstate it by the provider's cut on every reading.
   */
  amountRaw: string;
  /** The provider's own dollar estimate, where it states one. An estimate. */
  amountUsd: number | null;
  /** Who this balance belongs to once it is claimed. Always present. */
  split: FeeBalanceSplit;
  observedAt: string;
}>;

export type FeeBalanceSplit = Readonly<{
  /** Everything in the account. Equal to `amountRaw`. */
  grossRaw: string;
  /** The provider's share, taken at claim time. */
  providerRaw: string;
  /** What Ryntra can actually withdraw. The only figure worth calling ours. */
  ryntraClaimableRaw: string;
  /** Ryntra's share in basis points, and where that number came from. */
  ryntraShareBps: number;
  shareSource: "PROJECT_ACCOUNT" | "WHOLE_BALANCE";
}>;

export type FeeBalanceRead =
  | Readonly<{ ok: true; balances: readonly FeeBalance[] }>
  | Readonly<{ ok: false; code: "NOT_CONFIGURED" | "UNREACHABLE" | "UNREADABLE"; reason: string }>;

/**
 * Relay's off-chain app-fee balance for a claim address.
 *
 * `minimumAmount` is deliberately ignored: it is a claim threshold, not a
 * balance, and reporting it as one would understate what has been earned.
 */
export async function fetchRelayAppFeeBalance(
  recipient: string | null,
  deps: Readonly<{ fetchImpl?: typeof fetch; now?: () => Date; origin?: string; timeoutMs?: number }> = {},
): Promise<FeeBalanceRead> {
  if (!recipient) return { ok: false, code: "NOT_CONFIGURED", reason: "No Relay app-fee claim address is configured." };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const observedAt = (deps.now ?? (() => new Date()))().toISOString();
  const url = new URL(`/app-fees/${recipient}/balances`, deps.origin ?? RELAY_API_ORIGIN).toString();
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000) });
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  if (!response.ok) return { ok: false, code: "UNREADABLE", reason: `Relay answered HTTP ${response.status}.` };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "UNREADABLE", reason: "Relay's balance answer was not JSON." };
  }
  const rows = (payload as { balances?: readonly unknown[] })?.balances;
  if (!Array.isArray(rows)) return { ok: false, code: "UNREADABLE", reason: "Relay's balance answer had no balances array." };
  const balances: FeeBalance[] = [];
  for (const row of rows) {
    const entry = row as { currency?: { address?: unknown; symbol?: unknown; decimals?: unknown }; amount?: unknown; amountUsd?: unknown };
    const amountRaw = typeof entry.amount === "string" && /^[0-9]+$/.test(entry.amount) ? entry.amount : null;
    if (amountRaw === null) continue;
    const usd = Number(entry.amountUsd);
    balances.push({
      mechanism: "RELAY_APP_FEE",
      asset: typeof entry.currency?.address === "string" ? entry.currency.address : "",
      symbol: typeof entry.currency?.symbol === "string" ? entry.currency.symbol : null,
      decimals: typeof entry.currency?.decimals === "number" ? entry.currency.decimals : null,
      amountRaw,
      amountUsd: Number.isFinite(usd) ? usd : null,
      /* Relay takes no cut of an app fee — its own charge is the platform fee,
         a separate line — so the whole balance is claimable and the provider's
         share is a stated zero rather than an unknown. */
      split: { grossRaw: amountRaw, providerRaw: "0", ryntraClaimableRaw: amountRaw, ryntraShareBps: 10_000, shareSource: "WHOLE_BALANCE" },
      observedAt,
    });
  }
  return { ok: true, balances };
}

/**
 * What is sitting in Ryntra's Jupiter referral token accounts.
 *
 * One read per mint, because a referral token account exists per fee mint and a
 * mint with no account is exactly the case where Jupiter executes the swap and
 * takes no fee. An absent account therefore reports **nothing**, never a zero
 * balance — the two look the same in a total and mean opposite things about
 * whether the setup is finished.
 */
/**
 * Ryntra's share of a Jupiter referral balance, read from the project rather
 * than believed from the documentation.
 *
 * The Referral program's `Project` account carries `default_share_bps` — the
 * partner's share — and Jupiter's Ultra project reads **8000** there. That is
 * the number that decides what a withdrawal actually pays out, so it is the
 * number to use; the documented "Jupiter takes 20%" agrees with it today and is
 * not the authority on what it will be tomorrow. Hard-coding 80% would keep
 * reporting the old figure silently on the day it changes.
 *
 * Layout, read off mainnet 2026-09-10: 8-byte discriminator, `base` (32),
 * `admin` (32), then a Borsh string — four little-endian length bytes and the
 * name — and then the `u16` share. For the Ultra project the name is
 * `Jupiter Ultra`, putting the share at offset 89.
 *
 * A project that cannot be read returns `null`, and the caller then reports the
 * gross with no claim about the split, because a wrong share is worse than a
 * missing one.
 */
export async function readJupiterPartnerShareBps(
  handle: SolanaRpcHandle,
  project: string = JUPITER_ULTRA_REFERRAL_PROJECT,
): Promise<number | null> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getAccountInfo(project as never, { encoding: "base64", commitment: "confirmed" }).send({ abortSignal }),
    );
    const value = (response as { value: { data?: unknown } | null }).value;
    const encoded = Array.isArray(value?.data) ? value.data[0] : null;
    if (typeof encoded !== "string") return null;
    const data = Buffer.from(encoded, "base64");
    if (data.length < 78) return null;
    const nameLength = data.readUInt32LE(72);
    const offset = 76 + nameLength;
    if (nameLength > 64 || offset + 2 > data.length) return null;
    const share = data.readUInt16LE(offset);
    /* A share outside the possible range means the layout moved, and a number
       read from the wrong bytes is worse than no number. */
    return share > 0 && share <= 10_000 ? share : null;
  } catch {
    return null;
  }
}

export async function fetchJupiterReferralBalance(
  referralAccount: string | null,
  mints: readonly Readonly<{ mint: string; symbol: string; decimals: number }>[],
  deps: Readonly<{ handle?: SolanaRpcHandle; now?: () => Date }> = {},
): Promise<FeeBalanceRead> {
  if (!referralAccount) return { ok: false, code: "NOT_CONFIGURED", reason: "No Jupiter referral account is configured." };
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet" });
  const observedAt = (deps.now ?? (() => new Date()))().toISOString();
  const addresses = mints.map((entry) => ({ ...entry, tokenAccount: getAssociatedTokenAddress(new PublicKey(entry.mint), new PublicKey(referralAccount), true).toString() }));
  let values: readonly ({ data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } } } | null)[];
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getMultipleAccounts(addresses.map((entry) => entry.tokenAccount) as never, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal }),
    );
    values = (response as { value: readonly ({ data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } } } | null)[] }).value;
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  /* Read once for the whole set: the share belongs to the project, not to a mint. */
  const shareBps = await readJupiterPartnerShareBps(handle);
  const balances: FeeBalance[] = [];
  addresses.forEach((entry, index) => {
    const amount = values[index]?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) return;
    const gross = BigInt(amount);
    /* The provider's share rounds **up**, so the figure recorded as claimable by
       Ryntra is never the optimistic one. With no readable share, nothing is
       claimed about the split at all. */
    const provider = shareBps === null ? null : (gross * BigInt(10_000 - shareBps) + 9_999n) / 10_000n;
    balances.push({
      mechanism: "JUPITER_REFERRAL",
      asset: entry.mint,
      symbol: entry.symbol,
      decimals: entry.decimals,
      amountRaw: amount,
      /* No dollar figure: this is a chain read and pricing it here would turn a
         fact into an estimate. */
      amountUsd: null,
      split:
        provider === null || shareBps === null
          ? { grossRaw: amount, providerRaw: "0", ryntraClaimableRaw: amount, ryntraShareBps: 10_000, shareSource: "WHOLE_BALANCE" }
          : {
              grossRaw: amount,
              providerRaw: provider.toString(),
              ryntraClaimableRaw: (gross - provider).toString(),
              ryntraShareBps: shareBps,
              shareSource: "PROJECT_ACCOUNT",
            },
      observedAt,
    });
  });
  return { ok: true, balances };
}
