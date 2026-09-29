import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { readBaseNonceState } from "@/lib/base/cctp-observe";
import { baseRpcCall, createEvmRpcHandle } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { fetchCctpAttestation } from "@/lib/solana/cctp-attestation";
import { observeSolanaCctpArrival } from "@/lib/solana/cctp-arrival";
import { cctpBurnRecovery, readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { cctpLaneFacts } from "@/lib/solana/cctp-direction";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "@/lib/solana/cctp-registry";
import { SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where is the money, and what happens next.
 *
 * This route reads and only reads. It cannot burn, it cannot mint and it
 * exports no path that could: recovery on this lane means inspecting the burn,
 * then Circle's message, then the destination, in that order, and reporting
 * what each one says. Canon §25.5 is explicit that a second burn is never a
 * recovery action, and the way to make that true is to give recovery no way to
 * cause one.
 *
 * Every read is allowed to fail. An unreadable answer is reported as
 * unreadable, never as an absence — "we could not ask" and "it did not happen"
 * lead a person to opposite actions.
 */

const RequestSchema = z.object({ intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/) }).strict();

export async function POST(request: Request) {
  /* Recovery is a read and belongs on the read budget: the card polls it every
     three seconds while an outcome is open, which is twenty a minute against an
     action window of twelve, and exhausting that window would also refuse the
     calls the person needs to act. This route submits nothing. */
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);

  const claim = await readCctpBurnClaim({
    store: getGuardRuntime().store,
    network: "mainnet",
    intentDigest: parsed.data.intentDigest,
  });
  if (!claim.ok) return bridgeFailure(409, claim.code, claim.reason, rate);
  const record = claim.record;
  const recovery = cctpBurnRecovery(record);
  const lane = cctpLaneFacts(record.direction);

  let burn:
    | Readonly<{ state: "NOT_SUBMITTED" }>
    | Readonly<{ state: "READ"; confirmed: boolean; slot: string | null; landedError: string | null; observedBy: string }>
    | Readonly<{ state: "UNREADABLE"; reason: string }> = { state: "NOT_SUBMITTED" };
  if (record.burnSignature && lane.source.chain !== "solana") {
    /* On an EVM source the burn is an ordinary transaction, so its receipt is
       the whole answer: present means it landed, and a status of zero means it
       landed and reverted. An absent receipt is *pending*, never absent. */
    const evm = createEvmRpcHandle(lane.evmChain, { requireArchive: true });
    const read = await baseRpcCall<{ status?: string; blockNumber?: string } | null>(
      evm,
      "eth_getTransactionReceipt",
      [record.burnSignature],
    );
    burn = read.ok
      ? read.value
        ? {
            state: "READ",
            confirmed: true,
            slot: read.value.blockNumber ? String(BigInt(read.value.blockNumber)) : null,
            landedError: String(read.value.status ?? "").toLowerCase() === "0x1" ? null : `The transfer reverted on ${lane.source.label}.`,
            observedBy: evm.endpoints[0].host,
          }
        : { state: "READ", confirmed: false, slot: null, landedError: null, observedBy: evm.endpoints[0].host }
      : { state: "UNREADABLE", reason: read.reason };
  } else if (record.burnSignature) {
    const handle = createSolanaRpcHandle({ network: "mainnet" });
    try {
      const statuses = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .getSignatureStatuses([record.burnSignature as never], { searchTransactionHistory: true })
          .send({ abortSignal }),
      );
      const status = statuses.value[0];
      const answered = handle.answered() ?? handle.endpoints[0];
      burn = status
        ? {
            state: "READ",
            confirmed: true,
            slot: String(status.slot),
            landedError:
              status.err === null || status.err === undefined
                ? null
                : JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
            observedBy: answered.host,
          }
        : /* The cluster answered and has no record of it. That is still not a
             licence to burn again: the claim decides that, from what it knows
             was handed to the network. */
          { state: "READ", confirmed: false, slot: null, landedError: null, observedBy: answered.host };
    } catch (cause) {
      burn = { state: "UNREADABLE", reason: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  const attestation = record.burnSignature
    ? await fetchCctpAttestation({ direction: record.direction, transactionHash: record.burnSignature })
    : null;

  /* The destination's own replay guard, asked on whichever chain that is. On
     Base it is the transmitter's `usedNonces` mapping; on Solana it is a
     `used_nonce` account whose existence is the guard. The two say the same
     thing and neither is inferred from the other. */
  let destination: unknown = null;
  if (record.messageNonce && lane.destination.chain !== "solana") {
    destination = await readBaseNonceState(createEvmRpcHandle(lane.evmChain), record.messageNonce);
  } else if (record.messageNonce && record.destinationWallet) {
    const handle = createSolanaRpcHandle({ network: "mainnet" });
    try {
      const recipientTokenAccount = await associatedTokenAccount({
        owner: record.destinationWallet,
        mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        tokenProgram: SOLANA_TOKEN_PROGRAM,
      });
      const arrival = await observeSolanaCctpArrival(handle, {
        nonce: record.messageNonce,
        sourceDomain: lane.source.domain,
        remoteTokenHex: `${"0".repeat(24)}${lane.source.usdc.slice(2).toLowerCase()}`,
        recipientTokenAccount,
        signature: record.mintTransactionHash,
      });
      destination = {
        state: arrival.nonceState,
        nonce: record.messageNonce,
        reason: arrival.reason,
        observedBy: arrival.facts?.observedBy ?? null,
      };
    } catch (cause) {
      destination = {
        state: "UNREADABLE",
        nonce: record.messageNonce,
        reason: cause instanceof Error ? cause.message : String(cause),
        observedBy: null,
      };
    }
  }

  return Response.json(
    {
      data: {
        claim: {
          direction: record.direction,
          state: record.state,
          attempt: record.attempt,
          destinationWallet: record.destinationWallet,
          burnSignature: record.burnSignature,
          messageNonce: record.messageNonce,
          mintTransactionHash: record.mintTransactionHash,
          receiptHash: record.receiptHash,
          reservedAt: record.reservedAt,
          updatedAt: record.updatedAt,
          trail: record.trail,
        },
        recovery,
        burn,
        attestation,
        destination,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}
