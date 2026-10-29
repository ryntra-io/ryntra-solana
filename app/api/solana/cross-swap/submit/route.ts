import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { baseRpcCall, createEvmRpcHandle, EVM_CHAIN_IDS, hexQuantityToDecimal, type EvmChainId } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import {
  markCrossSwapArmed,
  markCrossSwapNeverBroadcast,
  markCrossSwapRecoveryRequired,
  markCrossSwapSubmitted,
  readCrossSwapOrder,
  releaseAbandonedCrossSwap,
  sha256HexOf,
  type CrossSwapOrderRecord,
} from "@/lib/mayan/cross-swap-order";
import { historyDestinationFor } from "@/lib/swap/cross-swap-service";
import { Connection, PublicKey } from "@solana/web3.js";

import { checkSignedCrossSwapTransaction } from "@/lib/mayan/signed-transaction";
import { lookupTableAddressesOf } from "@/lib/solana/wallet-modification";
import { mutationOriginAllowed } from "@/lib/security";
import { crossSwapOutcome, recordSolanaAction } from "@/lib/solana/action-ledger";
import { effectiveCrossSwapRouteState, resolveSolanaCrossSwapRouteState } from "@/lib/solana/lane-state";
import { claimCrossSwapCanarySubmit, readCrossSwapCanary } from "@/lib/solana/cross-swap-canary-record";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { sendTransactionOnce, SolanaSubmitRpcError } from "@/lib/solana/submit-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one boundary of a cross-chain swap, crossed once.
 *
 * Solana-origin (`SOLANA`): the wallet's signed bytes come back, are checked
 * against the reviewed bytes and the owner's key, re-simulated with signature
 * verification, and sent exactly once. An RPC that says the blockhash is gone
 * releases the order as never broadcast; any other unknown answer marks it for
 * recovery and nothing is retried.
 *
 * EVM-origin: an EVM wallet signs and broadcasts atomically, so the boundary
 * is crossed *before* the wallet opens (`ARM`), the hash is reported after
 * (`RECORD`), and a wallet that declined is the only way back (`ABANDON`) —
 * proved by the source wallet's pending count, never by the client's word.
 * Every pre-boundary refusal carries `submitBoundary: NOT_CROSSED`.
 */

const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const SolanaSchema = z
  .object({
    phase: z.literal("SOLANA"),
    intentDigest: z.string().regex(HEX_DIGEST),
    reviewedTransactionBase64: z.string().regex(BASE64).max(12_000),
    signedTransactionBase64: z.string().regex(BASE64).max(12_000),
  })
  .strict();
const ArmSchema = z.object({ phase: z.literal("ARM"), intentDigest: z.string().regex(HEX_DIGEST) }).strict();
const RecordSchema = z
  .object({ phase: z.literal("RECORD"), intentDigest: z.string().regex(HEX_DIGEST), transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), call: z.object({ to: z.string(), data: z.string(), value: z.string() }).strict() })
  .strict();
const AbandonSchema = z.object({ phase: z.literal("ABANDON"), intentDigest: z.string().regex(HEX_DIGEST) }).strict();
const RequestSchema = z.discriminatedUnion("phase", [SolanaSchema, ArmSchema, RecordSchema, AbandonSchema]);

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}
function failure(status: number, code: string, message: string, rate: RateLimitDecision, extra: object = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: headers(rate) });
}
function refuseBeforeSubmit(status: number, code: string, message: string, rate: RateLimitDecision, extra: object = {}) {
  return failure(status, code, message, rate, { submitBoundary: "NOT_CROSSED", ...extra });
}

function isEvmChain(chain: string): chain is EvmChainId {
  return (EVM_CHAIN_IDS as readonly string[]).includes(chain);
}

/** The EVM wallet's pending transaction count, as the chain reports it now; null when it cannot be read. */
async function readSourceAccountNonce(chain: EvmChainId, wallet: string): Promise<string | null> {
  const read = await baseRpcCall<string>(createEvmRpcHandle(chain), "eth_getTransactionCount", [wallet, "pending"]);
  return read.ok ? hexQuantityToDecimal(read.value) : null;
}

async function writeHistory(store: ReturnType<typeof getGuardRuntime>["store"], record: CrossSwapOrderRecord, now: string) {
  /* Off the record, not off a pair lookup — see the same note in the status
     route. This one matters more: it runs at the moment the boundary is
     crossed, so a miss here loses the row that says money is in motion. */
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: record.sourceChain === "solana" ? record.sourceWallet : record.destinationWallet,
    actionId: record.intentDigest,
    lane: "CROSS_SWAP",
    outcome: crossSwapOutcome(record.state),
    out: { mint: null, amountRaw: record.amountInRaw, decimals: record.fromDecimals, symbol: record.fromSymbol },
    destination: historyDestinationFor(record.destinationChain),
    ...(record.sourceTxHash && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(record.sourceTxHash) ? { signature: record.sourceTxHash } : {}),
    now,
  });
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return failure(403, "FORBIDDEN_ORIGIN", "This request did not come from Ryntra.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The submit request did not match its schema.", rate);
  const input = parsed.data;

  const store = getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return refuseBeforeSubmit(503, "STORE_NOT_DURABLE", "The durable order store is required to submit.", rate);
  const read = await readCrossSwapOrder({ store, intentDigest: input.intentDigest });
  if (!read.ok) return refuseBeforeSubmit(read.code === "CROSS_SWAP_ORDER_ABSENT" ? 404 : 503, read.code, read.reason, rate);
  const record = read.record;
  const now = () => new Date().toISOString();

  if (input.phase === "ABANDON") {
    /* The client says its wallet declined. That releases a plan that never
       crossed the boundary; a crossed EVM order is released only when the
       chain still shows the pending count recorded at `ARM` (FIX-XSWAP-1). */
    let observedNonce: string | null = null;
    if (record.state === "SUBMITTED_UNKNOWN" && isEvmChain(record.sourceChain)) {
      observedNonce = await readSourceAccountNonce(record.sourceChain, record.sourceWallet);
      if (observedNonce === null) {
        return failure(503, "SOURCE_ACCOUNT_UNREADABLE", "The source chain could not be asked whether this wallet has sent anything, so the order stays recorded as possibly under way.", rate, {
          released: false,
          state: record.state,
        });
      }
    }
    const released = await releaseAbandonedCrossSwap({ store, intentDigest: record.intentDigest, at: now(), observedNonce });
    if (!released.ok) {
      return failure(409, released.code === "CROSS_SWAP_ORDER_STATE" ? "RELEASE_NOT_ESTABLISHED" : released.code, "Nothing proves this order was never sent, so it stays recorded as possibly under way and is resolved by reading, never by sending again.", rate, {
        released: false,
        state: released.record?.state ?? record.state,
      });
    }
    return Response.json({ released: true, state: released.record.state }, { headers: headers(rate) });
  }

  /* The gate is this order's route, not the lane in general: Robinhood Chain
     carries a switch of its own beneath the lane's. `RECORD` is exempt for the
     reason it always was — it reports a transaction a wallet has already
     broadcast, and refusing to write that down would lose it, not prevent it. */
  const configuredState = resolveSolanaCrossSwapRouteState(record.sourceChain, record.destinationChain);
  const canaryRead = configuredState === "CANARY" ? await readCrossSwapCanary(store) : null;
  const permission = effectiveCrossSwapRouteState(configuredState, canaryRead?.ok ? canaryRead.record : null);
  if (permission === "CLOSED" && input.phase !== "RECORD") {
    return refuseBeforeSubmit(409, "CROSS_SWAP_PAUSED", "This route is not open yet.", rate);
  }

  /* The single submit attempt of a controlled operation, claimed atomically at
     the last instant before value can move, and never earlier.

     It used to be claimed here, at the top of the route, on the reasoning that
     the loser of a race should be refused before anything reaches a wallet. But
     by the time this route runs the wallet has already been reached — the
     signature is in the request body — and everything between here and the
     broadcast is a check that can still prove nothing was sent: the bytes are
     not the reviewed ones, the wallet changed them, the signature does not
     verify, the order would fail on chain, the blockhash died. Consuming the
     one attempt on any of those spends a controlled operation on an operation
     that never happened. It cost the first attempt of the Robinhood Chain
     canary: the wallet returned modified bytes, the check correctly refused,
     nothing was broadcast, and the route closed anyway.

     So the claim now sits immediately before the point of no return, in each
     path. The race guarantee is unchanged and the window is smaller: the claim
     is still atomic, still one winner, and still ahead of every broadcast.

     `ABANDON` and `RECORD` remain outside it. `ABANDON` releases a plan that
     was never broadcast and moves nothing; `RECORD` writes down a transaction a
     wallet has already sent, and refusing to write that down would lose it
     rather than prevent it. */
  const claimCanarySubmit = async () => {
    if (configuredState !== "CANARY") return null;
    const claimed = await claimCrossSwapCanarySubmit(store, record.intentDigest, now());
    return claimed.ok ? null : refuseBeforeSubmit(409, claimed.code, claimed.reason, rate);
  };

  if (input.phase === "ARM") {
    if (record.sourceChain === "solana") return refuseBeforeSubmit(409, "PHASE_MISMATCH", "A Solana order is submitted with its signed bytes, not armed.", rate);
    /* The count `ABANDON` will compare against, read before anything is armed:
       the only thing that can later prove the wallet sent nothing. */
    if (!isEvmChain(record.sourceChain)) return refuseBeforeSubmit(409, "PHASE_MISMATCH", "Only an EVM order is armed.", rate);
    const sourceAccountNonce = await readSourceAccountNonce(record.sourceChain, record.sourceWallet);
    if (sourceAccountNonce === null) {
      return refuseBeforeSubmit(503, "SOURCE_ACCOUNT_UNREADABLE", "This wallet's position on the source chain could not be read, and without it a declined swap could not be told apart from a sent one.", rate);
    }
    /* On an EVM origin, arming *is* the last step before the wallet sends. */
    const refused = await claimCanarySubmit();
    if (refused) return refused;
    const armed = await markCrossSwapArmed({ store, intentDigest: record.intentDigest, at: now(), sourceAccountNonce });
    if (!armed.ok) return refuseBeforeSubmit(409, armed.code, armed.reason, rate, { state: armed.record?.state ?? record.state });
    return Response.json({ state: armed.record.state, intentDigest: record.intentDigest }, { headers: headers(rate) });
  }

  if (input.phase === "RECORD") {
    if (record.sourceChain === "solana") return failure(409, "PHASE_MISMATCH", "A Solana order records its own signature.", rate);
    const callHash = sha256HexOf(`${input.call.to.toLowerCase()}|${input.call.data.toLowerCase()}|${input.call.value.toLowerCase()}`);
    if (record.reviewedCallHash !== callHash) {
      /* The wallet broadcast something; the record still says so, but under recovery. */
      await markCrossSwapRecoveryRequired({ store, intentDigest: record.intentDigest, at: now() });
      return failure(409, "REVIEWED_CALL_MISMATCH", "The call reported is not the one this order was planned with; the order is under recovery.", rate);
    }
    const marked = await markCrossSwapSubmitted({ store, intentDigest: record.intentDigest, sourceTxHash: input.transactionHash.toLowerCase(), at: now() });
    if (!marked.ok) return failure(409, marked.code, marked.reason, rate, { state: marked.record?.state ?? record.state });
    await writeHistory(store, marked.record, now());
    return Response.json({ state: marked.record.state, sourceTxHash: marked.record.sourceTxHash }, { headers: headers(rate) });
  }

  /* SOLANA */
  if (record.sourceChain !== "solana") return refuseBeforeSubmit(409, "PHASE_MISMATCH", "An EVM order is armed and recorded, not submitted with Solana bytes.", rate);
  if (record.state !== "RESERVED") {
    return refuseBeforeSubmit(409, "CROSS_SWAP_ALREADY_STARTED", `This order is in ${record.state}; nothing is submitted twice.`, rate, { state: record.state });
  }
  if (!record.reviewedWireHash) return refuseBeforeSubmit(409, "REVIEWED_BYTES_MISSING", "This order has no reviewed bytes on record.", rate);
  const handle = createSolanaRpcHandle({ network: "mainnet" });

  /* A provider-built route lives almost entirely in address lookup tables —
     Relay's deposit names two static accounts and three more behind one table.
     Reading the tables lets the comparison below check *addresses* instead of
     positions, so a wallet that repacks or inlines them is no longer mistaken
     for one that substituted an account. A table that cannot be read is simply
     absent from this map, and the comparison falls back to its stricter test. */
  const lookupTables: Record<string, readonly string[]> = {};
  const tableAddresses = [
    ...new Set([
      ...lookupTableAddressesOf(input.reviewedTransactionBase64),
      ...lookupTableAddressesOf(input.signedTransactionBase64),
    ]),
  ];
  if (tableAddresses.length > 0) {
    try {
      const connection = new Connection(handle.endpoint, "confirmed");
      const fetched = await Promise.all(tableAddresses.map((address) => connection.getAddressLookupTable(new PublicKey(address))));
      fetched.forEach((entry, index) => {
        const value = entry.value;
        if (value) lookupTables[tableAddresses[index]] = value.state.addresses.map((address) => address.toBase58());
      });
    } catch {
      /* Left empty on purpose: unresolved means stricter, never looser. */
    }
  }

  const check = checkSignedCrossSwapTransaction({
    reviewedWireBase64: input.reviewedTransactionBase64,
    reviewedWireHash: record.reviewedWireHash,
    signedWireBase64: input.signedTransactionBase64,
    owner: record.sourceWallet,
    lookupTables,
  });
  /* The comparison's reason rides along: a refusal nobody can act on is a
     dead end, and this one names which check moved. */
  if (!check.ok) return refuseBeforeSubmit(409, check.code, check.reason, rate, check.walletChange ? { walletChange: check.walletChange } : {});

  try {
    const simulation = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .simulateTransaction(input.signedTransactionBase64 as never, { encoding: "base64", sigVerify: true, replaceRecentBlockhash: false, commitment: "confirmed" })
        .send({ abortSignal }),
    );
    if (simulation.value.err !== null && simulation.value.err !== undefined) {
      const error = JSON.stringify(simulation.value.err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry));
      if (/BlockhashNotFound/i.test(error)) {
        await markCrossSwapNeverBroadcast({ store, intentDigest: record.intentDigest, at: now() });
        return refuseBeforeSubmit(409, "EXPIRED_BEFORE_SUBMIT", "The Review expired before the order was sent. Nothing left your wallet.", rate);
      }
      return refuseBeforeSubmit(409, "SIMULATION_FAILED", "The signed order would fail on chain, so it was not sent.", rate, { error });
    }
  } catch (cause) {
    return refuseBeforeSubmit(502, "SIMULATION_UNAVAILABLE", `The signed order could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`, rate);
  }

  /* Everything above could still prove nothing was sent. Nothing below can. */
  const refused = await claimCanarySubmit();
  if (refused) return refused;

  const armed = await markCrossSwapArmed({ store, intentDigest: record.intentDigest, at: now() });
  if (!armed.ok) return refuseBeforeSubmit(409, armed.code, armed.reason, rate, { state: armed.record?.state ?? record.state });

  let signature: string;
  try {
    signature = await sendTransactionOnce({ handle, signedWireBase64: input.signedTransactionBase64 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof SolanaSubmitRpcError && /Blockhash not found|block height exceeded|expired/i.test(message)) {
      await markCrossSwapNeverBroadcast({ store, intentDigest: record.intentDigest, at: now() });
      return refuseBeforeSubmit(409, "EXPIRED_BEFORE_SUBMIT", "The Review expired before the order was sent. Nothing left your wallet.", rate);
    }
    await markCrossSwapRecoveryRequired({ store, intentDigest: record.intentDigest, at: now() });
    return failure(502, "SUBMIT_UNKNOWN", "The network did not confirm whether the order was sent. It is under recovery; nothing is sent again.", rate, {
      submitBoundary: "CROSSED",
      expectedSignature: check.signature,
    });
  }

  const submitted = await markCrossSwapSubmitted({ store, intentDigest: record.intentDigest, sourceTxHash: signature, at: now() });
  const current = submitted.ok ? submitted.record : { ...record, state: "SUBMITTED" as const, sourceTxHash: signature };
  await writeHistory(store, current, now());
  return Response.json(
    { signature, state: current.state, intentDigest: record.intentDigest, submitBoundary: "CROSSED", comparison: check.comparison },
    { headers: headers(rate) },
  );
}
