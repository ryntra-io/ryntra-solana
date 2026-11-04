import type { GuardStore } from "../guard/store.ts";
import { walletClusters } from "./cluster-check.server.ts";
import { jsonRpc } from "./pool-share-read.server.ts";
import { readFunding, readTransfers } from "./protect-chain.server.ts";
import { PROTECT_SOLANA_RPC } from "./protect-deps.server.ts";
import { isYoung, signalHash, signalKeyFrom } from "./protect.ts";
import type { ReferralCheckDeps } from "./referral-guard-store.ts";
import { readFundingNodes } from "./review-store.ts";

/**
 * The production reads of the pair check: the cluster check the city already asks (`walletClusters`), on the same
 * public node and signal key as the Network's protection and «First $10 back». Null without the key — every pair
 * then waits, and nothing that would need a hash is kept.
 */
export function referralCheckDeps(store: GuardStore, env: Readonly<Record<string, string | undefined>> = process.env): ReferralCheckDeps | null {
  const key = signalKeyFrom(env);
  if (!key) return null;
  const rpc = jsonRpc(PROTECT_SOLANA_RPC, { attempts: 4 });
  return {
    clusters: walletClusters({ store, key, funding: (wallet) => readFunding(rpc, wallet), transfers: (wallet, since) => readTransfers(rpc, wallet, since) }),
    /* The trader's funding node, which the cluster check has just read and kept. */
    young: async (wallet, at) => {
      const hash = signalHash(key, "address", wallet);
      const node = (await readFundingNodes(store, [hash], at)).get(hash);
      return node ? isYoung(node, at) : null;
    },
  };
}
