/**
 * Solana as a network of the core.
 *
 * It wraps what production already does and adds no new path: one send of
 * signed bytes through the deployment's own RPC (`sendTransactionOnce`, no
 * retry, no fallback), and the chain's word on a signature read through an
 * operator other than the one that sent it (`readSignatureStatus`). The
 * balances read is the plain one — lamports and both token programs — for
 * callers that need what a wallet holds; the portfolio keeps its own richer
 * read.
 */

import { readSignatureStatus } from "../../solana/recover.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "../../solana/rpc.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../solana/send-kinds.ts";
import { sendTransactionOnce, SolanaSubmitRpcError } from "../../solana/submit-rpc.ts";
import type { Address, Balance, NetworkAdapter, Settlement, SignedTx, SubmitMode, Submission } from "../contracts.ts";

/** Native SOL, named as the core names a network's own asset. */
export const SOLANA_NATIVE_ASSET = "native:sol";

/** The lane name a submission through this deployment's own RPC carries. */
export const SOLANA_OWN_RPC_LANE = "OWN_RPC";

export type SolanaNetwork = NetworkAdapter;

/**
 * The settled state of a status read. A signature the chain shows is settled
 * at the level it shows — `finalized`, or `confirmed` for anything less — and
 * a landed failure is still a landing; a signature no operator shows, or an
 * operator that did not answer, is not seen.
 */
export function settlementOf(signature: string, read: Awaited<ReturnType<typeof readSignatureStatus>>): Settlement {
  if (read.state !== "READ" || !read.status.seen) return { state: "NOT_SEEN", signature };
  const finality = read.status.confirmationStatus === "finalized" ? "finalized" : "confirmed";
  if (read.status.err !== null) return { state: "LANDED_FAILED", signature, reason: read.status.err, finality };
  return { state: "SETTLED", signature, finality };
}

/**
 * A definite refusal of these bytes: the RPC's preflight simulated them and they failed (-32002), not for a blockhash
 * the node had not seen yet. Sending the same bytes again is refused the same way (SOL-S1). An unhealthy node, a rate
 * limit or a blockhash the RPC is behind on is not this: those are the sends a re-send lands.
 */
function preflightRefused(cause: unknown): boolean {
  if (!(cause instanceof SolanaSubmitRpcError) || cause.rpcCode !== "-32002") return false;
  const text = `${cause.message} ${JSON.stringify(cause.rpcData ?? null, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}`;
  return !/BlockhashNotFound|Blockhash not found/i.test(text);
}

export function createSolanaNetwork(args: Readonly<{
  /** The deployment's own primary — the only one a send goes through. */
  submitHandle: SolanaRpcHandle;
  /** An operator other than the sender, for every read after a send. */
  readHandle: SolanaRpcHandle;
}>): SolanaNetwork {
  const { submitHandle, readHandle } = args;
  return {
    network: "solana",
    async submit(tx: SignedTx, _mode: SubmitMode): Promise<Submission> {
      /* One lane serves both modes on this network today, and says so. */
      try {
        await sendTransactionOnce({ handle: submitHandle, signedWireBase64: tx.wireBase64 });
        return { state: "SENT", signature: tx.signature, lane: SOLANA_OWN_RPC_LANE };
      } catch (cause) {
        const reason = cause instanceof SolanaSubmitRpcError || cause instanceof Error ? cause.message : String(cause);
        return { state: "UNKNOWN", signature: tx.signature, lane: SOLANA_OWN_RPC_LANE, reason, ...(preflightRefused(cause) ? { rejected: true } : {}) };
      }
    },
    async observe(signature: string): Promise<Settlement> {
      return settlementOf(signature, await readSignatureStatus(readHandle, signature));
    },
    async balances(owner: Address): Promise<Balance[]> {
      const lamports = await withRpcDiscipline(readHandle, (abortSignal) =>
        readHandle.rpc.getBalance(owner as never, { commitment: "confirmed" }).send({ abortSignal }),
      );
      const held = new Map<string, { amount: bigint; decimals: number | null }>();
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const accounts = await withRpcDiscipline(readHandle, (abortSignal) =>
          readHandle.rpc
            .getTokenAccountsByOwner(owner as never, { programId: programId as never }, { encoding: "jsonParsed", commitment: "confirmed" })
            .send({ abortSignal }),
        );
        for (const entry of accounts.value) {
          const info = (entry.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } }).parsed?.info;
          const mint = info?.mint;
          const amount = info?.tokenAmount?.amount;
          if (!mint || amount === undefined || !/^[0-9]+$/.test(amount)) continue;
          const prior = held.get(mint);
          held.set(mint, { amount: (prior?.amount ?? 0n) + BigInt(amount), decimals: info?.tokenAmount?.decimals ?? prior?.decimals ?? null });
        }
      }
      return [
        { network: "solana", asset: SOLANA_NATIVE_ASSET, amountRaw: String(lamports.value), decimals: 9, spendableRaw: null },
        ...[...held].map(([mint, { amount, decimals }]): Balance => ({
          network: "solana",
          asset: mint,
          amountRaw: amount.toString(),
          decimals,
          spendableRaw: null,
        })),
      ];
    },
  };
}
