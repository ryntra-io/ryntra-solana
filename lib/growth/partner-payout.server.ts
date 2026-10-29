import { readSignatureStatus } from "../solana/recover.ts";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import { readAddressEvidence } from "../evidence/service.server.ts";
import { payRewardClaim, readRewardsReserve } from "../rewards/treasury.server.ts";
import type { PayoutChainReads, PayoutDeps } from "./partner-payout.ts";

/**
 * The chain and the treasury for partner payouts — exactly those of a cashback
 * claim (`lib/rewards/claim-settlement.server.ts`, `lib/rewards/treasury.server.ts`):
 * the same Rewards treasury, the same key, the same independent status read.
 * Nothing here decides whether to pay; `lib/growth/partner-payout.ts` does.
 */
export function payoutChainReads(): PayoutChainReads {
  const submission = createSolanaRpcHandle({ network: "mainnet" });
  const independent = createIndependentReadHandle(submission);
  return {
    readStatus: async (signature) => {
      const read = await readSignatureStatus(independent ?? submission, signature);
      return read.state === "READ" ? read.status : null;
    },
    ...(independent
      ? {
          blockhashValid: async (blockhash: string) => {
            const read = await withRpcDiscipline(independent, (abortSignal) => independent.rpc.isBlockhashValid(blockhash as never, { commitment: "confirmed" }).send({ abortSignal }));
            return typeof read.value === "boolean" ? read.value : null;
          },
        }
      : {}),
  };
}

export function payoutDeps(): PayoutDeps {
  return {
    ...payoutChainReads(),
    readTreasuryUsdMicros: async () => {
      const reserve = await readRewardsReserve();
      return reserve.state === "FUNDED" || reserve.state === "EMPTY" || reserve.state === "PARTIAL" ? reserve.usdMicros : null;
    },
    pay: (args) => payRewardClaim(args),
    /* The same screening Send shows before a transfer: the source's own word for the address. */
    screen: async (wallet) => {
      const read = await readAddressEvidence({ address: wallet });
      return read.evidence?.sanctions.state ?? "unavailable";
    },
  };
}
