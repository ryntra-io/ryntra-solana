/**
 * The reward for a launch's pool liquidity — the one transaction of the supply's step that sets it up: the
 * pool's creator reward slot paying the launch's own coin, and its emission funded, in one message the creator signs
 * with the rest of the step. The terms are `lib/core/launch/dlmm-pro.ts`; the instructions are the SDK's own, as the
 * venue builds them (`lib/core/venues/meteora-dlmm-pro/rewards.server.ts`).
 *
 * Why not the venue's two builds: its `fund` reads the slot from the chain and refuses one that is not set up yet — and
 * here the slot is set up by the same transaction. One message, both instructions: the reward is on chain whole or
 * not at all, and a launch whose reward did not land is taken up with this one transaction again.
 *
 * What the program does with it (SDK 0.1.3, its `docs.md` and IDL; rehearsed in
 * `scripts/launch-qa/dlmm-pro-rewards-rehearsal.mjs`):
 *
 * - `initialize_reward(0)` — only the pool's creator, only slot 0 (slot 1 is Meteora's operator's: the program asks for
 *   the operator's account, `MissingOperatorAccount`); the creator names itself the slot's authority and pays the rent
 *   of its vault. The launch's coin — Token-2022 with its metadata, no freeze authority — needs no token badge.
 * - `set_reward_emission` — the authority moves the whole emission into the vault at once: the rate over the window,
 *   rounded up, never more than `maxAmount`. The window is the reward's days from the opening; the program takes a start
 *   between now and thirty days ahead, and one to 365 days. A running emission cannot be changed, topped up or
 *   cancelled (`InvalidRewardState`); what the program emitted while no liquidity stood at the price is the authority's
 *   to take back once the window is over (`withdraw_ineligible_rewards`) — nothing else ever is.
 *
 * The creator is the fee payer and the only signer: no fresh key, no key of Ryntra's, no fee of Ryntra's.
 */

import { CREATOR_REWARD_INDEX, calculateTransferFeeIncludedAmount } from "@meteora-ag/dlmm-pro-sdk";
import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import { dlmmProEmission } from "../core/launch/dlmm-pro.ts";
import { DLMM_PRO_ACCOUNT_BYTES, assertAffords, clockOf, tokenBadgeFor, transferFeeMintOf } from "../core/venues/meteora-dlmm-pro/pools.server.ts";
import { DlmmProRefusal, dlmmProClientOf } from "../core/venues/meteora-dlmm-pro/sdk.server.ts";
import { DLMM_PRO_UNITS, seal, type DlmmProTx, type SealOptions } from "../core/venues/meteora-dlmm-pro/tx.server.ts";

export { REWARD_START_MARGIN_SECONDS } from "../core/venues/meteora-dlmm-pro/rewards.server.ts";

export type LaunchRewardBuild = DlmmProTx &
  Readonly<{
    /** The slot's vault: the account the transaction makes. */
    vault: string;
    emissionPerSecondX64: string;
    /** What the vault is funded with — the rate over the window, rounded up: never more than the reward. */
    fundedRaw: string;
    opensAt: number;
    endsAt: number;
    rentLamports: number;
    rentReturnedLamports: number;
  }>;

/**
 * The reward's transaction: slot 0 of the launch's pool set up with the launch's coin and the creator as its authority,
 * and `amountRaw` of the coin emitted from `opensAt` for `seconds`. Refused before a signature where the coin would need
 * Meteora's badge, the amount is too small to emit, or the creator cannot pay it.
 */
export async function buildLaunchReward(
  connection: Connection,
  request: Readonly<{ pool: string; creator: string; mint: string; amountRaw: bigint; seconds: number; opensAt: number }>,
  options: SealOptions = {},
): Promise<LaunchRewardBuild> {
  const pool = new PublicKey(request.pool);
  const creator = new PublicKey(request.creator);
  const mint = new PublicKey(request.mint);
  const client = dlmmProClientOf(connection);
  const [mintInfo, clock] = await Promise.all([connection.getAccountInfo(mint, "confirmed"), clockOf({ connection })]);
  if (!mintInfo) throw new DlmmProRefusal("BAD_INPUT", "The launch's coin is not on chain.");
  const badge = await tokenBadgeFor(connection, mint, mintInfo, "reward");
  const emission = dlmmProEmission(request.amountRaw, request.seconds);
  if (emission.perSecondX64 === 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The reward is too small to pay over its days.");
  const endsAt = request.opensAt + request.seconds;
  /* The vault receives the funded amount exactly; a coin with a transfer fee would cost its fee on top — the launch's coin has none. */
  const maximumPaid = calculateTransferFeeIncludedAmount(await transferFeeMintOf(connection, mint), clock.epoch, new BN(emission.fundedRaw.toString())).amount;
  const init = await client.reward.initializeReward({ pool, rewardMint: mint, rewardAuthority: creator, creator, payer: creator, tokenProgram: mintInfo.owner, ...(badge ? { tokenBadge: badge } : {}) });
  const fund = await client.reward.setRewardEmission({
    pool,
    rewardMint: mint,
    funder: creator,
    authority: creator,
    tokenProgram: mintInfo.owner,
    parameters: { index: CREATOR_REWARD_INDEX, openTime: new BN(request.opensAt), endTime: new BN(endsAt), emissionPerSecond: new BN(emission.perSecondX64.toString()), maxAmount: maximumPaid },
  });
  if (!init.rewardVault.equals(fund.rewardVault)) throw new DlmmProRefusal("FAILED", "The reward's two instructions name different vaults.");
  const instructions = [...init.tx.instructions, ...fund.tx.instructions];
  const sealed = await seal({ connection, wallet: creator, instructions, units: DLMM_PRO_UNITS.initializeReward + DLMM_PRO_UNITS.fundReward + DLMM_PRO_UNITS.tokenAccount, options });
  /* The creator pays the vault's rent and the reward itself, from the coins the launch minted to it. */
  const cost = await assertAffords(connection, creator, [{ mint, program: mintInfo.owner, amount: BigInt(maximumPaid.toString()) }], { fee: BigInt(sealed.feeLamports), instructions, accounts: [DLMM_PRO_ACCOUNT_BYTES.tokenAccount2022] });
  return { ...sealed, ...cost, vault: init.rewardVault.toBase58(), emissionPerSecondX64: emission.perSecondX64.toString(), fundedRaw: emission.fundedRaw.toString(), opensAt: request.opensAt, endsAt };
}
