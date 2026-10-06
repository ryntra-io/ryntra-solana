import type { GuardStore } from "../guard/store.ts";
import { readRankStanding } from "../rewards/rank-store.ts";
import type { RewardRank } from "../rewards/rules.ts";
import { hasAvatarFrame } from "./badges.ts";
import { isHiddenWallet } from "./league-store.ts";

/**
 * The frames a chart draws around traders' avatars: Silver and above.
 *
 * The call the token page makes, on the server, for the wallets whose trades
 * its chart marks. It answers only the frame — a rank from Silver up, or
 * null — never points, shares or anything a rank card says: the frame is the
 * status the wallet earned, and the rest is its own business. A wallet that
 * cannot be read is drawn without a frame rather than failing the chart.
 */

/** A chart marks at most this many distinct wallets per read. */
export const AVATAR_FRAMES_MAX = 50;

export async function readAvatarFrames(
  store: GuardStore,
  wallets: readonly string[],
  at: string = new Date().toISOString(),
): Promise<ReadonlyMap<string, RewardRank | null>> {
  const unique = [...new Set(wallets.filter((wallet) => typeof wallet === "string" && wallet.length >= 32 && wallet.length <= 64))].slice(0, AVATAR_FRAMES_MAX);
  const read = await Promise.all(
    unique.map(async (wallet) => {
      try {
        /* A wallet hidden from the boards wears no frame anywhere: its status is not shown. */
        if (await isHiddenWallet(store, wallet)) return [wallet, null] as const;
        const { rank } = await readRankStanding(store, wallet, at);
        return [wallet, hasAvatarFrame(rank) ? rank : null] as const;
      } catch {
        return [wallet, null] as const;
      }
    }),
  );
  return new Map(read);
}
