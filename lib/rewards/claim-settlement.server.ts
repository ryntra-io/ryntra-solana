import type { GuardStore } from "../guard/store.ts";
import { readSignatureStatus } from "../solana/recover.ts";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import type { RewardClaim } from "./claim.ts";
import { reconcileRewardClaim } from "./claim-settlement.ts";

export async function reconcileClaimOnChain(store: GuardStore, claim: RewardClaim, now: string) {
  const submission = createSolanaRpcHandle({ network: "mainnet" });
  const independent = createIndependentReadHandle(submission);
  return reconcileRewardClaim(store, claim, {
    now,
    readStatus: async signature => {
      const read = await readSignatureStatus(independent ?? submission, signature);
      return read.state === "READ" ? read.status : null;
    },
    ...(independent ? { blockhashValid: async (blockhash: string) => {
      const read = await withRpcDiscipline(independent, abortSignal => independent.rpc.isBlockhashValid(blockhash as never, { commitment: "confirmed" }).send({ abortSignal }));
      return typeof read.value === "boolean" ? read.value : null;
    } } : {}),
  });
}
