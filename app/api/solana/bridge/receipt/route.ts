import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { observeBaseCctpMint, readBaseUsdcBalance, secondOperator } from "@/lib/base/cctp-observe";
import { baseRpcCall, createEvmRpcHandle, hexQuantityToDecimal } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { SOLANA_CAIP2 } from "@/lib/agent-control/adapters/solana-token-2022";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { fetchCctpAttestation } from "@/lib/solana/cctp-attestation";
import { observeSolanaCctpArrival, readSolanaUsdcBalance } from "@/lib/solana/cctp-arrival";
import { recordSolanaAction } from "@/lib/solana/action-ledger";
import { cctpBurnRecovery, markCctpReceipted, readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { cctpLaneFacts, isSolanaSourceDirection } from "@/lib/solana/cctp-direction";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "@/lib/solana/cctp-registry";
import { SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import {
  BRIDGE_RECEIPT_LIMITATIONS,
  mintCctpOutcomeReceipt,
  SolanaBridgeReceiptFactsSchema,
} from "@/lib/solana/cctp-receipt";
import { CctpReviewProofSchema, verifyCctpReviewProof } from "@/lib/solana/cctp-review-proof";
import { verifySolanaOutcomeReceipt } from "@/lib/solana/receipt";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";

/** A Solana transaction signature, matching what the action ledger will accept. */
const SOLANA_TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mint the Bridge Receipt from facts read at the moment of issuing.
 *
 * Deliberately not folded into `../observe`. That route answers "did it
 * arrive"; this one makes a signed statement about a completed transfer, and
 * a statement needs every field read fresh rather than carried forward from
 * whichever earlier call happened to have it. So the burn's finality, Circle's
 * message, the destination arrival and the recipient's balance are all re-read
 * here, and anything that does not answer becomes a null the reconciliation
 * has to account for.
 *
 * The receipt is an `OUTCOME_RECEIPT@2.0.0`, signed by the same issuer key as
 * every other Ryntra receipt and accepted by the same public verifier. Its
 * `actionPassportHash` is the Review proof digest, so it cannot describe more
 * than what was authorized.
 *
 * Which chain is the source and which the destination comes from the durable
 * claim. Both directions produce the same document with the same fields; the
 * chains inside it swap, and nothing about the statement's shape does.
 */

const RequestSchema = z
  .object({
    bundle: z
      .object({
        plan: z.object({}).passthrough(),
        provider: z.object({}).passthrough(),
        rpc: z.object({ role: z.enum(["primary", "fallback", "independent"]), host: z.string().min(1) }).strict(),
        simulation: z
          .object({
            status: z.enum(["PRESENT", "SKIPPED"]),
            succeeded: z.boolean(),
            error: z.string().nullable(),
            unitsConsumed: z.string().nullable(),
          })
          .strict(),
        canaryIntent: z.object({}).passthrough(),
        canaryVerdict: z.object({}).passthrough(),
      })
      .strict(),
    reviewProof: CctpReviewProofSchema,
    /** The destination transaction the owner sent, when they sent one. */
    mintTransactionHash: z
      .union([z.string().regex(/^0x[0-9a-fA-F]{64}$/), z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/)])
      .nullable()
      .default(null),
    usdcBeforeRaw: z.string().regex(/^(0|[1-9][0-9]*)$/).max(20).nullable().default(null),
  })
  .strict();

const DEFAULT_WINDOW_BLOCKS = 9_999n;

type SolanaPlan = import("@/lib/solana/cctp-plan").CctpBurnPlan;
type BasePlan = import("@/lib/base/cctp-burn").BaseBurnPlan;

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);

  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return bridgeFailure(
      503,
      "REVIEW_PROOF_UNAVAILABLE",
      "This deployment has no document-signing key, so it cannot issue a receipt bound to a Review.",
      rate,
    );
  }
  const proofCheck = verifyCctpReviewProof({
    bundle: parsed.data.bundle as never,
    proof: parsed.data.reviewProof,
    trustedPublicKey: issuerKey.publicKey,
  });
  if (!proofCheck.ok) return bridgeFailure(409, "REVIEW_PROOF_REFUSED", proofCheck.reason, rate);

  const rawPlan = (parsed.data.bundle as unknown as { plan: { intentDigest: string; direction: string } }).plan;
  const store = getGuardRuntime().store;
  const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: rawPlan.intentDigest });
  if (!claim.ok) return bridgeFailure(409, claim.code, claim.reason, rate);
  const record = claim.record;
  if (!record.burnSignature) {
    return bridgeFailure(409, "NO_BURN_RECORDED", "No burn is recorded for this transfer, so there is nothing to receipt.", rate);
  }
  if (rawPlan.direction !== record.direction) {
    return bridgeFailure(409, "DIRECTION_MISMATCH", "The reviewed plan and the recorded transfer disagree about direction.", rate);
  }

  /* Which builder runs is decided by which chain the recorded transfer left
     from, never by which EVM chain it touched: the two builders differ by
     source kind, and Base and Ethereum take the same builder with their own
     chain facts. */
  const built = isSolanaSourceDirection(record.direction)
    ? await solanaToEvmFacts({
        plan: parsed.data.bundle as unknown as { plan: SolanaPlan },
        record,
        reviewDigest: parsed.data.reviewProof.digest,
        usdcBeforeRaw: parsed.data.usdcBeforeRaw,
        mintTransactionHash: parsed.data.mintTransactionHash,
      })
    : await evmToSolanaFacts({
        plan: parsed.data.bundle as unknown as { plan: BasePlan },
        record,
        reviewDigest: parsed.data.reviewProof.digest,
        usdcBeforeRaw: parsed.data.usdcBeforeRaw,
        mintTransactionHash: parsed.data.mintTransactionHash,
      });

  const facts = SolanaBridgeReceiptFactsSchema.safeParse(built.facts);
  if (!facts.success) {
    return bridgeFailure(
      422,
      "FACTS_INVALID",
      facts.error.issues.map((issue) => `${issue.path.join(".") || "facts"}: ${issue.message}`).join(" · "),
      rate,
    );
  }

  const minted = mintCctpOutcomeReceipt({
    id: `outcome_solana_bridge_${record.burnSignature.replace(/^0x/, "").slice(0, 16)}`,
    actionPassportHash: parsed.data.reviewProof.digest,
    facts: facts.data,
  });
  if (!minted.ok) return bridgeFailure(422, minted.code, minted.reason, rate);

  let recorded = false;
  if (minted.facts.reconciliation === "MATCHED" || minted.receipt.outcome.status === "DEVIATION_RECORDED") {
    const marked = await markCctpReceipted({
      store,
      network: "mainnet",
      intentDigest: rawPlan.intentDigest,
      receiptHash: minted.receipt.contentHash,
    });
    recorded = marked.ok;

    /* The transfer is finished on both chains and reconciled. The history row
       written when the money left crosses to done here, and gains the receipt
       it can be opened by. It is written against the Solana wallet either way,
       because that is the wallet this workspace is scoped to.

       It now also carries the direction, the amount and the Solana signature,
       and that is a repair rather than a tidy-up. Read from production on
       2026-09-04: both Base → Solana rows had `destination`, `out`, `in` and
       `signature` all null, so History rendered them as "Moved to Base" with no
       amount and no way to open them — three defects from one cause. The
       forward lane escaped it only because its burn route records those fields
       when the money leaves; the reverse lane's equivalent write is conditional
       on a claim field, and where it does not land nothing later establishes
       them. This is the one write that always happens on a settled transfer and
       it knows the whole truth, so it should record it.

       Every field is passed only when it has a value. `recordSolanaAction`
       merges on `undefined` and overwrites on `null`, so an omitted leg keeps
       whatever an earlier write already recorded and this can only ever add. */
    if (built.historyWallet) {
      const toSolana = !isSolanaSourceDirection(minted.facts.direction);
      /* Resolved from the signed facts to one of the three chains a History
         row can name — "SOLANA", "BASE" or "ETHEREUM" — never from the route. */
      const historyDestination = toSolana ? "SOLANA" : minted.facts.direction === "SOLANA_TO_ETHEREUM" ? "ETHEREUM" : "BASE";
      /* `mint: null` on purpose, exactly as the burn route does it: this lane
         carries native USDC and nothing else, and a field that could only ever
         hold one value is not a fact worth storing. */
      const moved = (amountRaw: string) => ({ mint: null, amountRaw, decimals: 6, symbol: "USDC" });
      const arrived = toSolana ? (minted.facts.amounts.mintedRaw ?? minted.facts.amounts.expectedReceivedRaw) : null;
      /* Only a Solana signature belongs in this field. A Base transaction hash
         would fail the row's own schema, and a failed write costs the whole row
         — a worse outcome than the missing explorer link it would have fixed. */
      const solanaSignature = toSolana
        ? minted.facts.destination.mintTransactionHash
        : minted.facts.source.burnSignature;
      await recordSolanaAction(store, {
        network: "mainnet",
        wallet: built.historyWallet,
        actionId: rawPlan.intentDigest,
        lane: "BRIDGE",
        outcome: "DONE",
        destination: historyDestination,
        ...(toSolana ? {} : { out: moved(minted.facts.amounts.burnedRaw) }),
        ...(arrived === null ? {} : { in: moved(arrived) }),
        ...(solanaSignature !== null && SOLANA_TX_SIGNATURE.test(solanaSignature)
          ? { signature: solanaSignature }
          : {}),
        receiptHash: minted.receipt.contentHash,
        now: new Date().toISOString(),
      });
    }
  }

  /* The same public verifier a stranger would run, run here so the answer
     arrives with the receipt rather than being something the person is told to
     go and check for themselves. Its four axes are reported separately, never
     collapsed into one word. */
  const verification = verifySolanaOutcomeReceipt(minted.receipt, {
    trustedPublicKeys: [issuerKey.publicKey],
  });

  return Response.json(
    {
      data: {
        direction: record.direction,
        receipt: minted.receipt,
        facts: minted.facts,
        verification: {
          recognised: verification.recognised,
          schemaValid: verification.schema.valid,
          integrityValid: verification.integrity.valid,
          issuer: verification.issuer.verdict,
          binding: verification.binding.verdict,
        },
        recorded,
        balances: built.balances,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}

type BuiltFacts = Readonly<{
  facts: Record<string, unknown>;
  balances: unknown;
  /** The Solana wallet whose History this transfer belongs in. */
  historyWallet: string | null;
}>;

/** A Solana-source lane: burned on Solana, minted on the EVM chain the claim names. */
async function solanaToEvmFacts(args: {
  plan: { plan: SolanaPlan };
  record: import("@/lib/solana/cctp-burn-claim").CctpBurnClaimRecord;
  reviewDigest: string;
  usdcBeforeRaw: string | null;
  mintTransactionHash: string | null;
}): Promise<BuiltFacts> {
  const plan = args.plan.plan;
  const record = args.record;
  const lane = cctpLaneFacts(record.direction);
  const burnSignature = record.burnSignature as string;

  /* Source: what the cluster says about the burn, from the operator that did
     not submit it. */
  const solana = createSolanaRpcHandle({ network: "mainnet" });
  let slot: string | null = null;
  let finality: "confirmed" | "finalized" | "unknown" = "unknown";
  let observedBy = solana.endpoints[0].host;
  try {
    const statuses = await withRpcDiscipline(solana, (abortSignal) =>
      solana.rpc.getSignatureStatuses([burnSignature as never], { searchTransactionHistory: true }).send({ abortSignal }),
    );
    const status = statuses.value[0];
    observedBy = (solana.answered() ?? solana.endpoints[0]).host;
    if (status) {
      slot = String(status.slot);
      const confirmation = String(status.confirmationStatus ?? "");
      finality = confirmation === "finalized" ? "finalized" : confirmation === "" ? "unknown" : "confirmed";
    }
  } catch {
    /* An unreadable status is not an unlanded burn. It stays `unknown`, and
       the reconciliation records that rather than assuming either way. */
  }

  const attestation = await fetchCctpAttestation({
    direction: record.direction,
    transactionHash: burnSignature,
    expect: {
      destinationDomain: plan.destinationDomain,
      mintRecipient: plan.mintRecipientHex,
      amountRaw: plan.amountRaw,
    },
  });
  const burnBody = attestation.attested?.decoded.burn ?? null;
  const header = attestation.attested?.decoded.header ?? null;

  const base = createEvmRpcHandle(lane.evmChain, { requireArchive: true });
  const nonce = record.messageNonce ?? attestation.attested?.nonce ?? null;
  let observation = null as Awaited<ReturnType<typeof observeBaseCctpMint>> | null;
  if (nonce) {
    const head = await baseRpcCall<string>(base, "eth_blockNumber", []);
    const decimal = head.ok ? hexQuantityToDecimal(head.value) : null;
    if (decimal !== null) {
      const toBlock = BigInt(decimal);
      observation = await observeBaseCctpMint(base, {
        nonce,
        fromBlock: toBlock > DEFAULT_WINDOW_BLOCKS ? toBlock - DEFAULT_WINDOW_BLOCKS : 0n,
        toBlock,
      });
    }
  }
  const afterBalance = await readBaseUsdcBalance(base, plan.destinationRecipient);
  const other = afterBalance.ok ? secondOperator(base, afterBalance.observedBy) : null;
  const secondRead = other ? await readBaseUsdcBalance({ ...base, endpoints: [other] }, plan.destinationRecipient) : null;

  let destinationGasUsed: string | null = null;
  let destinationGasPriceWei: string | null = null;
  const mintHash = observation?.facts?.transactionHash ?? args.mintTransactionHash;
  if (mintHash) {
    const receipt = await baseRpcCall<{ gasUsed?: string; effectiveGasPrice?: string }>(
      base,
      "eth_getTransactionReceipt",
      [mintHash],
    );
    if (receipt.ok && receipt.value) {
      destinationGasUsed = hexQuantityToDecimal(receipt.value.gasUsed) ?? null;
      destinationGasPriceWei = hexQuantityToDecimal(receipt.value.effectiveGasPrice) ?? null;
    }
  }

  const recovery = cctpBurnRecovery(record);
  return {
    historyWallet: plan.owner,
    balances: {
      primary: afterBalance.ok ? { raw: afterBalance.raw, observedBy: afterBalance.observedBy } : null,
      second: secondRead?.ok ? { raw: secondRead.raw, observedBy: secondRead.observedBy } : null,
      agree: afterBalance.ok && secondRead?.ok ? afterBalance.raw === secondRead.raw : null,
    },
    facts: {
      schema: "ryntra.solana.bridge-receipt.facts@2",
      provider: "CIRCLE_CCTP_V2",
      direction: record.direction,
      intentDigest: plan.intentDigest,
      reviewDigest: args.reviewDigest,
      source: {
        chainRef: SOLANA_CAIP2.mainnet,
        domain: 5,
        wallet: plan.owner,
        tokenAccount: plan.ownerTokenAccount,
        asset: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        burnSignature,
        slot,
        finality,
        observedBy,
      },
      destination: {
        chainRef: lane.destination.chainRef,
        domain: lane.destination.domain,
        recipient: plan.destinationRecipient,
        recipientAccount: null,
        asset: lane.destination.usdc,
        mintTransactionHash: observation?.facts?.transactionHash ?? null,
        blockNumber: observation?.facts?.blockNumber ?? null,
        finality: observation?.state === "MINTED" ? "included" : "unknown",
        observedBy: observation?.facts?.observedBy ?? null,
        recipientReadiness:
          args.usdcBeforeRaw !== null && afterBalance.ok
            ? "BALANCE_READ_BEFORE_AND_AFTER"
            : afterBalance.ok
              ? "BALANCE_READ_BEFORE_ONLY"
              : "NOT_ESTABLISHED",
        usdcBeforeRaw: args.usdcBeforeRaw,
        usdcAfterRaw: afterBalance.ok ? afterBalance.raw : null,
      },
      message: {
        nonce,
        cctpVersion: 2,
        status:
          attestation.state === "ATTESTED" ? "ATTESTED" : attestation.state === "UNAVAILABLE" ? "NOT_ESTABLISHED" : "PENDING",
        attestationRef: attestation.source.ref,
        minFinalityThreshold: plan.minFinalityThreshold,
        finalityThresholdExecuted: header?.finalityThresholdExecuted ?? null,
        expirationBlock: burnBody?.expirationBlock ?? null,
        destinationCaller: plan.destinationCallerHex,
      },
      amounts: {
        burnedRaw: plan.amountRaw,
        maxFeeRaw: plan.maxFeeRaw,
        feeExecutedRaw: burnBody?.feeExecutedRaw ?? null,
        expectedReceivedRaw: plan.expectedReceiveRaw,
        mintedRaw: observation?.facts?.mintedRaw ?? null,
        destinationFeeCollectedRaw: observation?.facts?.feeCollectedRaw ?? null,
      },
      fees: {
        sourceNetworkFeeLamports: plan.costs.baseFeeLamports,
        sourceRentLamports: plan.costs.messageSentRentLamports,
        rentReclaimable: true,
        rentReclaimableAfterDays: 5,
        sourceGasUsed: null,
        sourceGasPriceWei: null,
        destinationNetworkFeeLamports: null,
        destinationRentLamports: null,
        destinationGasUsed,
        destinationGasPriceWei,
        relayerFeeRaw: null,
        relayerFeeReason: "FORWARDING_SERVICE_NOT_USED",
      },
      /* Overwritten by the minter from the evidence above; supplied because the
         schema requires a value and a caller's guess must never be the one kept. */
      reconciliation: "NOT_OBSERVED",
      deviations: [],
      recovery: { attempts: record.attempt, secondBurnCreated: false, action: recovery.action },
      limitations: BRIDGE_RECEIPT_LIMITATIONS,
      observedAt: new Date().toISOString(),
    },
  };
}

/** An EVM-source lane: burned on Base or Ethereum, received on Solana. */
async function evmToSolanaFacts(args: {
  plan: { plan: BasePlan };
  record: import("@/lib/solana/cctp-burn-claim").CctpBurnClaimRecord;
  reviewDigest: string;
  usdcBeforeRaw: string | null;
  mintTransactionHash: string | null;
}): Promise<BuiltFacts> {
  const plan = args.plan.plan;
  const record = args.record;
  const lane = cctpLaneFacts(record.direction);
  const burnHash = record.burnSignature as string;

  /* Source: the Base receipt. Its presence is finality on an EVM chain and its
     status is whether the burn did anything at all. */
  const base = createEvmRpcHandle(lane.evmChain, { requireArchive: true });
  let blockNumber: string | null = null;
  let finality: "confirmed" | "finalized" | "unknown" = "unknown";
  let sourceGasUsed: string | null = null;
  let sourceGasPriceWei: string | null = null;
  const burnReceipt = await baseRpcCall<{ status?: string; blockNumber?: string; gasUsed?: string; effectiveGasPrice?: string } | null>(
    base,
    "eth_getTransactionReceipt",
    [burnHash],
  );
  if (burnReceipt.ok && burnReceipt.value) {
    blockNumber = hexQuantityToDecimal(burnReceipt.value.blockNumber);
    finality = String(burnReceipt.value.status ?? "").toLowerCase() === "0x1" ? "confirmed" : "unknown";
    sourceGasUsed = hexQuantityToDecimal(burnReceipt.value.gasUsed) ?? null;
    sourceGasPriceWei = hexQuantityToDecimal(burnReceipt.value.effectiveGasPrice) ?? null;
  }

  const attestation = await fetchCctpAttestation({
    direction: record.direction,
    transactionHash: burnHash,
    expect: {
      destinationDomain: 5,
      mintRecipient: plan.mintRecipientHex,
      amountRaw: plan.amountRaw,
    },
  });
  const burnBody = attestation.attested?.decoded.burn ?? null;
  const header = attestation.attested?.decoded.header ?? null;
  const nonce = record.messageNonce ?? attestation.attested?.nonce ?? null;

  const recipientOwner = record.destinationWallet ?? plan.destinationOwner;
  let recipientTokenAccount = plan.destinationRecipient;
  try {
    recipientTokenAccount = await associatedTokenAccount({
      owner: recipientOwner,
      mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
      tokenProgram: SOLANA_TOKEN_PROGRAM,
    });
  } catch {
    /* The plan already carries the derived account; a failure here leaves it
       as it was rather than inventing one. */
  }

  const solana = createSolanaRpcHandle({ network: "mainnet" });
  const observation = nonce
    ? await observeSolanaCctpArrival(solana, {
        nonce,
        sourceDomain: lane.source.domain,
        remoteTokenHex: `${"0".repeat(24)}${lane.source.usdc.slice(2).toLowerCase()}`,
        recipientTokenAccount,
        signature: record.mintTransactionHash ?? args.mintTransactionHash,
      })
    : null;

  const afterBalance = await readSolanaUsdcBalance(solana, recipientTokenAccount);

  /* What the receiving step cost, read from the transaction the cluster holds
     rather than from the plan that predicted it. */
  let destinationNetworkFeeLamports: string | null = null;
  const arrivalHash = observation?.facts?.transactionHash ?? record.mintTransactionHash ?? args.mintTransactionHash;
  if (arrivalHash && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(arrivalHash)) {
    try {
      const transaction = (await withRpcDiscipline(solana, (abortSignal) =>
        solana.rpc
          .getTransaction(arrivalHash as never, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" })
          .send({ abortSignal }),
      )) as { meta?: { fee?: bigint | number | string } } | null;
      if (transaction?.meta?.fee !== undefined) destinationNetworkFeeLamports = String(transaction.meta.fee);
    } catch {
      /* An unreadable fee is a null, never a zero. */
    }
  }

  const recovery = cctpBurnRecovery(record);
  return {
    historyWallet: recipientOwner,
    balances: {
      primary: afterBalance.ok ? { raw: afterBalance.raw, observedBy: afterBalance.observedBy } : null,
      second: null,
      agree: null,
    },
    facts: {
      schema: "ryntra.solana.bridge-receipt.facts@2",
      provider: "CIRCLE_CCTP_V2",
      direction: record.direction,
      intentDigest: plan.intentDigest,
      reviewDigest: args.reviewDigest,
      source: {
        chainRef: lane.source.chainRef,
        domain: lane.source.domain,
        wallet: plan.owner,
        /* An ERC-20 balance lives at the owner's own address, so there is no
           separate account for the money to have left. Null says that. */
        tokenAccount: null,
        asset: lane.source.usdc,
        burnSignature: burnHash,
        slot: blockNumber,
        finality,
        observedBy: base.endpoints[0].host,
      },
      destination: {
        chainRef: SOLANA_CAIP2.mainnet,
        domain: 5,
        recipient: recipientOwner,
        recipientAccount: recipientTokenAccount,
        asset: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        mintTransactionHash: observation?.facts?.transactionHash ?? null,
        blockNumber: observation?.facts?.slot ?? null,
        finality: observation?.state === "MINTED" ? "included" : "unknown",
        observedBy: observation?.facts?.observedBy ?? null,
        recipientReadiness:
          args.usdcBeforeRaw !== null && afterBalance.ok
            ? "BALANCE_READ_BEFORE_AND_AFTER"
            : afterBalance.ok
              ? "BALANCE_READ_BEFORE_ONLY"
              : "NOT_ESTABLISHED",
        usdcBeforeRaw: args.usdcBeforeRaw,
        usdcAfterRaw: afterBalance.ok ? afterBalance.raw : null,
      },
      message: {
        nonce,
        cctpVersion: 2,
        status:
          attestation.state === "ATTESTED" ? "ATTESTED" : attestation.state === "UNAVAILABLE" ? "NOT_ESTABLISHED" : "PENDING",
        attestationRef: attestation.source.ref,
        minFinalityThreshold: plan.minFinalityThreshold,
        finalityThresholdExecuted: header?.finalityThresholdExecuted ?? null,
        expirationBlock: burnBody?.expirationBlock ?? null,
        destinationCaller: plan.destinationCallerHex,
      },
      amounts: {
        burnedRaw: plan.amountRaw,
        maxFeeRaw: plan.maxFeeRaw,
        feeExecutedRaw: burnBody?.feeExecutedRaw ?? null,
        expectedReceivedRaw: plan.expectedReceiveRaw,
        mintedRaw: observation?.facts?.mintedRaw ?? null,
        destinationFeeCollectedRaw: observation?.facts?.feeCollectedRaw ?? null,
      },
      fees: {
        sourceNetworkFeeLamports: null,
        sourceRentLamports: null,
        /* Nothing on this lane is reclaimable: the replay account Solana creates
           is the guard that stops a second one, so it stays for ever. */
        rentReclaimable: false,
        rentReclaimableAfterDays: 0,
        sourceGasUsed,
        sourceGasPriceWei,
        destinationNetworkFeeLamports,
        destinationRentLamports: null,
        destinationGasUsed: null,
        destinationGasPriceWei: null,
        relayerFeeRaw: null,
        relayerFeeReason: "FORWARDING_SERVICE_NOT_USED",
      },
      reconciliation: "NOT_OBSERVED",
      deviations: [],
      recovery: { attempts: record.attempt, secondBurnCreated: false, action: recovery.action },
      limitations: BRIDGE_RECEIPT_LIMITATIONS,
      observedAt: new Date().toISOString(),
    },
  };
}
