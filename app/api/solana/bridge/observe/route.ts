import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { observeBaseCctpMint, reconcileBaseMint, readBaseUsdcBalance, secondOperator } from "@/lib/base/cctp-observe";
import { baseRpcCall, createEvmRpcHandle, hexQuantityToDecimal } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { markCctpMintObserved, readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { observeSolanaCctpArrival, readSolanaUsdcBalance, reconcileSolanaArrival } from "@/lib/solana/cctp-arrival";
import { cctpLaneFacts, EVM_ADDRESS_PATTERN, SOLANA_ADDRESS_PATTERN } from "@/lib/solana/cctp-direction";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "@/lib/solana/cctp-registry";
import { SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import { createIndependentReadHandle, createSolanaRpcHandle } from "@/lib/solana/rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read the destination side, independently, and say what arrived.
 *
 * Two answers, kept apart on purpose. The replay guard reads from the head of
 * the chain and says whether the message was consumed; the credit itself says
 * how much arrived and to whom, and needs history the free endpoints ration. A
 * window too narrow to hold the arrival therefore reports *consumed but unseen*
 * — the money arrived and the transaction is out of reach — instead of flipping
 * to "not arrived", which is the opposite answer and the one that invites a
 * second burn.
 *
 * Both chains answer the same two questions and the shape of the reply is the
 * same either way, so the card renders one thing rather than two. Which chain
 * is asked comes from the durable claim.
 *
 * The recipient's balance is read from a second operator when one exists, so
 * the arrival does not rest on a single provider's word.
 */

/* Base produces a block every two seconds, so the widest window a public
   archive endpoint serves is a little over five hours — far more than a
   Standard transfer takes, and the largest question that can be asked in one
   request. */
const DEFAULT_WINDOW_BLOCKS = 9_999n;

const RequestSchema = z
  .object({
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    /* The wallet the money is for, on whichever chain it lands on. */
    recipient: z.union([z.string().regex(EVM_ADDRESS_PATTERN), z.string().regex(SOLANA_ADDRESS_PATTERN)]),
    expectedReceivedRaw: z.string().regex(/^[1-9][0-9]*$/).max(20),
    fromBlock: z.string().regex(/^[0-9]+$/).max(20).optional(),
    toBlock: z.string().regex(/^[0-9]+$/).max(20).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);
  const input = parsed.data;

  const store = getGuardRuntime().store;
  const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: input.intentDigest });
  if (!claim.ok) return bridgeFailure(409, claim.code, claim.reason, rate);
  const nonce = claim.record.messageNonce;
  if (!nonce) {
    return bridgeFailure(
      409,
      "ATTESTATION_NOT_RECORDED",
      "No message nonce is recorded for this transfer, so there is nothing to look for on the other side.",
      rate,
    );
  }
  const direction = claim.record.direction;
  /* Which chain is asked comes from the claim's own direction: the EVM end of
     the lane, whichever of Base or Ethereum that is, and never Base by habit. */
  const lane = cctpLaneFacts(direction);

  if (lane.destination.chain === "solana") {
    if (!SOLANA_ADDRESS_PATTERN.test(input.recipient)) {
      return bridgeFailure(400, "VALIDATION_ERROR", "This transfer arrives on Solana, so its recipient is a Solana wallet.", rate);
    }
    let recipientTokenAccount: string;
    try {
      recipientTokenAccount = await associatedTokenAccount({
        owner: input.recipient,
        mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        tokenProgram: SOLANA_TOKEN_PROGRAM,
      });
    } catch (cause) {
      return bridgeFailure(
        422,
        "RECIPIENT_INVALID",
        `The receiving USDC account could not be derived: ${cause instanceof Error ? cause.message : String(cause)}`,
        rate,
      );
    }

    const handle = createSolanaRpcHandle({ network: "mainnet" });
    const observation = await observeSolanaCctpArrival(handle, {
      nonce,
      sourceDomain: lane.source.domain,
      /* The source chain's USDC as the thirty-two bytes the token pair is keyed on. */
      remoteTokenHex: `${"0".repeat(24)}${lane.source.usdc.slice(2).toLowerCase()}`,
      recipientTokenAccount,
      signature: claim.record.mintTransactionHash,
    });
    const reconciliation = reconcileSolanaArrival(observation, {
      recipientTokenAccount,
      receivedRaw: input.expectedReceivedRaw,
    });

    const primaryBalance = await readSolanaUsdcBalance(handle, recipientTokenAccount);
    const other = createIndependentReadHandle(handle);
    const secondBalance = other ? await readSolanaUsdcBalance(other, recipientTokenAccount) : null;

    let recorded = false;
    if (observation.state === "MINTED" && observation.facts) {
      const marked = await markCctpMintObserved({
        store,
        network: "mainnet",
        intentDigest: input.intentDigest,
        mintTransactionHash: observation.facts.transactionHash,
      });
      recorded = marked.ok;
    }

    return Response.json(
      {
        data: {
          direction,
          destinationChain: "solana",
          recipientTokenAccount,
          observation,
          reconciliation,
          recipientBalance: {
            primary: primaryBalance.ok ? { raw: primaryBalance.raw, observedBy: primaryBalance.observedBy } : null,
            second: secondBalance?.ok ? { raw: secondBalance.raw, observedBy: secondBalance.observedBy } : null,
            agree: primaryBalance.ok && secondBalance?.ok ? primaryBalance.raw === secondBalance.raw : null,
          },
          recorded,
          claimState: claim.record.state,
        },
      },
      { headers: bridgeHeaders(rate) },
    );
  }

  if (!EVM_ADDRESS_PATTERN.test(input.recipient)) {
    return bridgeFailure(
      400,
      "VALIDATION_ERROR",
      `This transfer arrives on ${lane.destination.label}, so its recipient is a ${lane.destination.label} address.`,
      rate,
    );
  }
  const handle = createEvmRpcHandle(lane.evmChain, { requireArchive: true });
  let toBlock: bigint;
  if (input.toBlock) {
    toBlock = BigInt(input.toBlock);
  } else {
    const head = await baseRpcCall<string>(handle, "eth_blockNumber", []);
    const decimal = head.ok ? hexQuantityToDecimal(head.value) : null;
    if (decimal === null) {
      return bridgeFailure(503, "BASE_HEAD_UNAVAILABLE", `${lane.destination.label} did not return a current block number.`, rate);
    }
    toBlock = BigInt(decimal);
  }
  const fromBlock = input.fromBlock
    ? BigInt(input.fromBlock)
    : toBlock > DEFAULT_WINDOW_BLOCKS
      ? toBlock - DEFAULT_WINDOW_BLOCKS
      : 0n;

  const observation = await observeBaseCctpMint(handle, { nonce, fromBlock, toBlock });
  const reconciliation = reconcileBaseMint(observation, {
    recipient: input.recipient,
    receivedRaw: input.expectedReceivedRaw,
  });

  /* A second operator's read of the same balance. Absent is reported as
     absent — asking one host twice and calling the result agreement is the
     failure this avoids. */
  const primaryBalance = await readBaseUsdcBalance(handle, input.recipient);
  const other = primaryBalance.ok ? secondOperator(handle, primaryBalance.observedBy) : null;
  const secondBalance = other
    ? await readBaseUsdcBalance({ ...handle, endpoints: [other] }, input.recipient)
    : null;

  let recorded = false;
  if (observation.state === "MINTED" && observation.facts) {
    const marked = await markCctpMintObserved({
      store,
      network: "mainnet",
      intentDigest: input.intentDigest,
      mintTransactionHash: observation.facts.transactionHash,
    });
    recorded = marked.ok;
  }

  return Response.json(
    {
      data: {
        direction,
        destinationChain: lane.destination.chain,
        observation,
        reconciliation,
        recipientBalance: {
          primary: primaryBalance.ok ? { raw: primaryBalance.raw, observedBy: primaryBalance.observedBy } : null,
          second: secondBalance?.ok ? { raw: secondBalance.raw, observedBy: secondBalance.observedBy } : null,
          agree:
            primaryBalance.ok && secondBalance?.ok ? primaryBalance.raw === secondBalance.raw : null,
        },
        recorded,
        claimState: claim.record.state,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}
