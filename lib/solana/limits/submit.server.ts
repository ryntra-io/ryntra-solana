/**
 * The signed bytes of a limit order, placed or cancelled: read again, proved
 * signed, written down, relayed once, and settled from the chain's own answer.
 *
 * The order of the steps is the lane's safety: the bytes must carry the
 * wallet's real signature over their own message (a request cannot write a row
 * under someone else's wallet with made-up bytes; on a DLMM placement the
 * order's fresh key signs after the wallet, and only bytes that do what was
 * reviewed); the record exists before the
 * bytes leave (a relay that lands with no row behind it is the one loss this
 * lane could make); the bytes are relayed once (never a second relay on a
 * timeout — the reconciler reads the signature instead); and the answer that
 * comes back only advances the row.
 */

import DLMM from "@meteora-ag/dlmm";
import { PublicKey, type Connection } from "@solana/web3.js";

import type { GuardStore } from "../../guard/store.ts";
import { limitsConnection } from "./chain.server.ts";
import { cosignDlmmPlace, inspectDlmmTransaction, signedByAll } from "./dlmm.server.ts";
import { DOLLAR_MINTS } from "../../core/fee-policy.ts";
import { effectiveTriggerPrice, impliedPrice, scaledDecimal, TRIGGER_V1_JUPITER_FEE_BPS, type LimitSide, type LimitVenue } from "./model.ts";
import { mintDecimals } from "./review.server.ts";
import { advanceLimitOrder, beginLimitOrder, limitOrderKey, readLimitOrder, type LimitOrderState } from "./store.server.ts";
import { executeTrigger, signatureOf } from "./trigger.server.ts";
import { inspectTriggerTransaction, signedByFeePayer } from "./trigger-tx.ts";

export type LimitPlaceTerms = Readonly<{
  side: LimitSide;
  baseMint: string;
  quoteMint: string;
  inputMint: string;
  outputMint: string;
  makingRaw: string;
  takingRaw: string;
  price: string;
  fillPrice: number;
  pool: string | null;
  fee: Readonly<{ ryntraBps: number; venueBps: number; account: string | null }>;
}>;

export type LimitSubmitRequest = Readonly<{
  kind: "place" | "cancel";
  venue: LimitVenue;
  owner: string;
  order: string;
  requestId: string | null;
  signedTransactionBase64: string;
  /** For a placement: what the Review showed, which the signed bytes must hold. */
  terms: LimitPlaceTerms | null;
}>;

export type LimitSubmitResult =
  | Readonly<{ ok: true; state: LimitOrderState; signature: string; settled: boolean }>
  | Readonly<{ ok: false; status: number; code: string; reason: string; beforeSubmit: boolean; signature?: string }>;

const CONFIRM_TIMEOUT_MS = 40_000;
/** What a cancellation may start from: a waiting order, a part-filled one, or a converted DLMM order being taken back. */
const CANCELLABLE: ReadonlySet<LimitOrderState> = new Set(["OPEN", "PARTIAL", "FILLED"]);

async function confirmSignature(connection: Connection, signature: string): Promise<"LANDED" | "FAILED" | "UNKNOWN"> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatuses([signature]).then((answer) => answer.value[0]).catch(() => undefined);
    if (status && status.err) return "FAILED";
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return "LANDED";
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return "UNKNOWN";
}

/**
 * The terms a record keeps: the amounts, tokens and fee are the signed bytes'
 * (already checked); the fill price is recomputed here from them, never taken
 * from the browser; the venue's fee is what the venue charges.
 */
async function provenTerms(request: LimitSubmitRequest, terms: LimitPlaceTerms, pool: string | null, connection: Connection): Promise<LimitPlaceTerms | string> {
  if (scaledDecimal(terms.price, 18) === null) return "The price is not a plain decimal.";
  const expectedInput = terms.side === "buy" ? terms.quoteMint : terms.baseMint;
  const expectedOutput = terms.side === "buy" ? terms.baseMint : terms.quoteMint;
  if (terms.inputMint !== expectedInput || terms.outputMint !== expectedOutput) return "The side does not match the tokens.";
  const [baseDecimals, quoteDecimals] = await Promise.all([mintDecimals(terms.baseMint, connection), mintDecimals(terms.quoteMint, connection)]);
  if (baseDecimals === null || quoteDecimals === null) return "The tokens could not be read from the chain.";
  const pair = { baseMint: terms.baseMint, baseDecimals, quoteMint: terms.quoteMint, quoteDecimals };
  const implied = impliedPrice(pair, terms.side, terms.makingRaw, terms.takingRaw);
  if (request.venue === "trigger") {
    const ryntraBps = terms.fee.account ? terms.fee.ryntraBps : 0;
    /* Jupiter's own fee is the program's, by the pair — never the browser's number. */
    const venueBps = terms.fee.account ? 0 : DOLLAR_MINTS.has(terms.inputMint) && DOLLAR_MINTS.has(terms.outputMint) ? TRIGGER_V1_JUPITER_FEE_BPS.stable : TRIGGER_V1_JUPITER_FEE_BPS.normal;
    return { ...terms, pool: null, fee: { ryntraBps, venueBps, account: terms.fee.account }, fillPrice: effectiveTriggerPrice(implied, terms.side, ryntraBps + venueBps) };
  }
  return { ...terms, pool, fee: { ryntraBps: 0, venueBps: 0, account: null }, fillPrice: implied };
}

export async function submitLimit(
  store: GuardStore,
  request: LimitSubmitRequest,
  deps: Readonly<{ connection?: Connection; now?: () => string; env?: Readonly<Record<string, string | undefined>> }> = {},
): Promise<LimitSubmitResult> {
  const connection = deps.connection ?? limitsConnection();
  const now = deps.now ?? (() => new Date().toISOString());
  const refuse = (status: number, code: string, reason: string): LimitSubmitResult => ({ ok: false, status, code, reason, beforeSubmit: true });
  if (request.kind === "place" && !request.terms) return refuse(400, "TERMS_REQUIRED", "A placement needs its reviewed terms.");

  /* 1. The signed bytes, read again with the rules of the Review, and proved signed. */
  let signature: string | null;
  /* What leaves: the wallet's bytes, or on a DLMM placement those bytes with the order's signature after the wallet's. */
  let relayed = request.signedTransactionBase64;
  let placedPool: string | null = null;
  if (request.venue === "trigger") {
    if (!request.requestId) return refuse(400, "REQUEST_ID_REQUIRED", "A Jupiter order needs its request id.");
    const terms = request.terms;
    const verdict = request.kind === "place" && terms
      ? inspectTriggerTransaction(request.signedTransactionBase64, {
        kind: "create",
        owner: request.owner,
        inputMint: terms.inputMint,
        outputMint: terms.outputMint,
        makingRaw: terms.makingRaw,
        takingRaw: terms.takingRaw,
        feeAccount: terms.fee.account,
        feeBps: terms.fee.account ? terms.fee.ryntraBps : null,
      })
      : inspectTriggerTransaction(request.signedTransactionBase64, { kind: "cancel", owner: request.owner, order: request.order });
    if (!verdict.ok) return refuse(422, "SIGNED_TRANSACTION_REFUSED", verdict.reason);
    if (verdict.order !== request.order) return refuse(422, "SIGNED_TRANSACTION_REFUSED", "The signed transaction is for another order.");
    if (!signedByFeePayer(request.signedTransactionBase64)) return refuse(422, "NOT_SIGNED", "The wallet's signature is missing or does not match.");
    signature = signatureOf(request.signedTransactionBase64);
  } else {
    const verdict = inspectDlmmTransaction(request.signedTransactionBase64, { owner: request.owner, kind: request.kind, limitOrder: request.order, pool: request.terms?.pool ?? null });
    if (!verdict.ok) return refuse(422, "SIGNED_TRANSACTION_REFUSED", verdict.reason);
    if (request.kind === "place") {
      const cosigned = cosignDlmmPlace(request.signedTransactionBase64, { owner: request.owner, limitOrder: request.order, pool: request.terms?.pool ?? null }, deps.env ?? process.env);
      if (!cosigned.ok) return refuse(cosigned.code === "ORDER_KEY_UNAVAILABLE" ? 503 : 422, cosigned.code === "SIGNED_MISMATCH" ? "SIGNED_TRANSACTION_REFUSED" : cosigned.code, cosigned.reason);
      relayed = cosigned.wireBase64;
    }
    if (!signedByAll(relayed)) return refuse(422, "NOT_SIGNED", "A signature is missing or does not match.");
    signature = verdict.signature;
    placedPool = verdict.pool;
  }
  if (!signature) return refuse(422, "NOT_SIGNED", "The wallet's signature is missing.");

  /* 2. The row, before the bytes leave. */
  const key = limitOrderKey({ wallet: request.owner, venue: request.venue, order: request.order });
  if (request.kind === "place") {
    const terms = await provenTerms(request, request.terms as LimitPlaceTerms, placedPool, connection);
    if (typeof terms === "string") return refuse(422, "TERMS_REFUSED", terms);
    const begun = await beginLimitOrder(store, {
      wallet: request.owner,
      venue: request.venue,
      order: request.order,
      pool: terms.pool,
      side: terms.side,
      baseMint: terms.baseMint,
      quoteMint: terms.quoteMint,
      inputMint: terms.inputMint,
      outputMint: terms.outputMint,
      makingRaw: terms.makingRaw,
      takingRaw: terms.takingRaw,
      price: terms.price,
      fillPrice: Number.isFinite(terms.fillPrice) ? terms.fillPrice : null,
      fee: terms.fee,
      state: "PLACING",
      placeSignature: signature,
      cancelSignature: null,
      fills: [],
      reason: null,
    }, now());
    if (!begun.ok) return refuse(409, begun.reason === "LIMIT_RECORD_EXISTS" ? "ALREADY_SUBMITTED" : "RECORD_UNAVAILABLE", "This order was already sent, or could not be written down.");
  } else {
    let claim: { inputRaw: string; outputRaw: string } | null = null;
    if (request.venue === "dlmm") {
      /* What converted, read before taking it back — the claim's receipt, kept on the row so a dying request does not lose it. */
      claim = await (async () => {
        const info = await connection.getAccountInfo(new PublicKey(request.order), "confirmed");
        if (!info) return null;
        const dlmm = await DLMM.create(connection, new PublicKey(info.data.subarray(8, 40)));
        const order = await dlmm.getLimitOrder(new PublicKey(request.order));
        const ask = order.limitOrderData.limitOrderBinData.some((bin) => bin.isAskSide);
        const data = order.limitOrderData;
        const inputRaw = ask ? (BigInt(data.totalDepositAmountX) - BigInt(data.totalUnfilledAmountX)).toString() : (BigInt(data.totalDepositAmountY) - BigInt(data.totalUnfilledAmountY)).toString();
        const outputRaw = ask ? data.totalSwappedAmountY : data.totalSwappedAmountX;
        return BigInt(outputRaw) > 0n ? { inputRaw, outputRaw } : null;
      })().catch(() => null);
    }
    const existing = await readLimitOrder(store, key);
    if (existing && !CANCELLABLE.has(existing.state)) return refuse(409, "NOT_CANCELLABLE", "This order is already closed or being closed.");
    if (existing) {
      const moved = await advanceLimitOrder(store, key, (current) => (CANCELLABLE.has(current.state) ? { state: "CANCELLING", cancelSignature: signature, cancelFrom: current.state, claim } : null), now());
      if (!moved.ok || moved.record.state !== "CANCELLING") return refuse(409, "NOT_CANCELLABLE", "This order is already closed or being closed.");
    }
  }

  /* 3. One relay. */
  let landed: "LANDED" | "FAILED" | "UNKNOWN";
  let reason: string | null = null;
  if (request.venue === "trigger") {
    const executed = await executeTrigger({ requestId: request.requestId as string, signedTransactionBase64: request.signedTransactionBase64 });
    if (executed.ok) {
      landed = executed.status === "Success" ? "LANDED" : "FAILED";
      reason = executed.reason;
    } else {
      /* Jupiter refused or did not answer: the chain is asked, never Jupiter twice. */
      landed = await confirmSignature(connection, signature);
      reason = executed.reason;
    }
  } else {
    try {
      await connection.sendRawTransaction(Buffer.from(relayed, "base64"), { skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" });
      landed = await confirmSignature(connection, signature);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      /* A preflight refusal is the network never seeing the bytes. */
      if (/simulation failed|preflight/i.test(message)) {
        if (request.kind === "place") await advanceLimitOrder(store, key, () => ({ state: "FAILED", reason: message.slice(0, 300) }), now());
        else await advanceLimitOrder(store, key, (current) => (current.state === "CANCELLING" ? { state: current.cancelFrom ?? "OPEN", cancelSignature: null, cancelFrom: null, claim: null } : null), now());
        return { ok: false, status: 422, code: "SIMULATION_FAILED", reason: message.slice(0, 300), beforeSubmit: true };
      }
      landed = await confirmSignature(connection, signature);
      reason = message;
    }
  }

  /* 4. The chain's answer advances the row; no answer leaves it for the reconciler. */
  if (request.kind === "place") {
    const state: LimitOrderState = landed === "LANDED" ? "OPEN" : landed === "FAILED" ? "FAILED" : "PLACING";
    await advanceLimitOrder(store, key, (current) => (current.state === "PLACING" ? { state, reason: state === "FAILED" ? (reason ?? "The placement failed on chain.") : null } : null), now());
    if (landed === "FAILED") return { ok: false, status: 422, code: "PLACEMENT_FAILED", reason: reason ?? "The placement failed on chain.", beforeSubmit: false, signature };
    return { ok: true, state, signature, settled: landed === "LANDED" };
  }
  const settled = await advanceLimitOrder(store, key, (current) => {
    if (current.state !== "CANCELLING") return null;
    if (landed === "UNKNOWN") return null;
    if (landed === "FAILED") return { state: current.cancelFrom ?? "OPEN", cancelSignature: null, cancelFrom: null, claim: null };
    if (current.claim) {
      /* Wholly converted is filled; part converted and the rest returned is cancelled, with its fill kept. */
      return { state: current.claim.inputRaw === current.makingRaw ? "FILLED" : "CANCELLED", cancelFrom: null, claim: null, fills: [...current.fills, { signature, inputRaw: current.claim.inputRaw, outputRaw: current.claim.outputRaw, feeRaw: "0", at: now() }] };
    }
    return { state: "CANCELLED", cancelFrom: null };
  }, now());
  const state: LimitOrderState = settled.ok ? settled.record.state : landed === "LANDED" ? "CANCELLED" : "CANCELLING";
  if (landed === "FAILED") return { ok: false, status: 422, code: "CANCEL_FAILED", reason: reason ?? "The cancellation failed on chain.", beforeSubmit: false, signature };
  return { ok: true, state, signature, settled: landed === "LANDED" };
}
