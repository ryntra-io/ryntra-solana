import { getGuardRuntime } from "@/lib/guard/runtime";

import { createIndependentReadHandle, createSolanaRpcHandle, type SolanaNetwork } from "./rpc.ts";

/**
 * What this deployment is actually able to do with a signed transfer.
 *
 * Two conditions decide it, and both used to be discovered by the submit route
 * — after a wallet had been opened and a person had already approved a
 * transaction. A deployment without a durable multi-writer store cannot record
 * that exact bytes crossed the submit boundary, so "submitted once" is not a
 * guarantee it can make; a deployment with one RPC operator cannot read the
 * outcome back from anyone but the endpoint that submitted it, so the receipt's
 * independence does not exist. Neither is a property of the transfer, and
 * neither can be fixed by trying again — they are facts about the deployment,
 * and the honest place to state them is the Review.
 *
 * Server-only. It reaches the guard runtime and the RPC configuration, so it
 * must never be imported by anything the browser bundles — `send-safety.ts`
 * takes these as plain inputs for exactly that reason.
 */
export function deploymentSendCapability(network: SolanaNetwork): Readonly<{
  settlementStore: "DURABLE_MULTI_WRITER" | "NOT_DURABLE";
  independentReadback: boolean;
}> {
  return {
    settlementStore:
      getGuardRuntime().store.durability === "DURABLE_MULTI_WRITER"
        ? "DURABLE_MULTI_WRITER"
        : "NOT_DURABLE",
    independentReadback: createIndependentReadHandle(createSolanaRpcHandle({ network })) !== null,
  };
}
