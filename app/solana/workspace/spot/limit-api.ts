/**
 * The limit ticket's and «Мої ордери»'s calls to the limits routes, typed, and
 * the wallet's signature between the Review and the relay. The routes decide;
 * this file only carries.
 */

import { MAX_SIGNABLE_WINDOW_MS, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransaction } from "@/lib/solana/wallet.client";
import type { LimitSide, LimitVenue } from "@/lib/solana/limits/model";
import type { LimitReview } from "@/lib/solana/limits/review.server";
import type { LimitOrderView } from "@/lib/solana/limits/sync.server";

export type { LimitReview, LimitOrderView };

export type LimitMarket = Readonly<{
  price: number | null;
  baseUsd: number | null;
  quoteUsd: number | null;
  dlmm: Readonly<{ available: true; pool: string; name: string; activePrice: number; binStep: number }> | Readonly<{ available: false; code: string }>;
}>;

export type LimitToken = Readonly<{ symbol: string | null; decimals: number | null }>;

export type LimitCallFailure = Readonly<{ ok: false; code: string; message: string; signature?: string }>;

async function post<T>(path: string, body: unknown): Promise<Readonly<{ ok: true; value: T }> | LimitCallFailure> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; signature?: string } }) | null;
    if (!response.ok || !json) {
      return { ok: false, code: json?.error?.code ?? `HTTP_${response.status}`, message: json?.error?.message ?? "", ...(json?.error?.signature ? { signature: json.error.signature } : {}) };
    }
    return { ok: true, value: json };
  } catch {
    return { ok: false, code: "NETWORK", message: "" };
  }
}

export function readLimitMarket(args: Readonly<{ owner: string | null; baseMint: string; quoteMint: string }>) {
  return post<LimitMarket>("/api/solana/limits/market", args);
}

export function reviewLimit(args: Readonly<{ owner: string; venue: LimitVenue; side: LimitSide; baseMint: string; quoteMint: string; amount: string; price: string; quoteUsd: number | null }>) {
  return post<{ review: LimitReview }>("/api/solana/limits/review", args);
}

export function readLimitOrders(owner: string) {
  return post<{ orders: LimitOrderView[]; tokens: Record<string, LimitToken>; complete: boolean }>("/api/solana/limits/orders", { owner });
}

export type WalletRef = Readonly<{ wallet: string; address: string }>;

export type SubmitAnswer = Readonly<{ state: string; signature: string; settled: boolean }>;

/** How long from arriving a Review's bytes may still be signed; a server from before AG-1 sent no figure. */
export function signableMsOfReview(review: LimitReview): number {
  return typeof review.signableMs === "number" && Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

/**
 * Sign the reviewed placement in the wallet and hand the bytes to the relay — unless they aged out while the wallet
 * was open (AG-1): then nothing is sent and `REVIEW_AGED` asks the ticket for a fresh Review.
 */
export async function signAndPlace(wallet: WalletRef, review: LimitReview, receivedAtMs: number): Promise<Readonly<{ ok: true; value: SubmitAnswer }> | LimitCallFailure> {
  const signed = await signTransaction({ wallet: wallet.wallet, address: wallet.address, unsignedWireBase64: review.transactionBase64, chain: "solana:mainnet" });
  if (!signed.ok) return { ok: false, code: "WALLET_REFUSED", message: signed.reason };
  if (signableWindowClosed({ receivedAtMs, signableMs: signableMsOfReview(review) })) return { ok: false, code: "REVIEW_AGED", message: "" };
  return post<SubmitAnswer>("/api/solana/limits/submit", {
    kind: "place",
    venue: review.venue,
    owner: wallet.address,
    order: review.order,
    requestId: review.requestId,
    signedTransactionBase64: signed.signedWireBase64,
    terms: {
      side: review.side,
      baseMint: review.pair.baseMint,
      quoteMint: review.pair.quoteMint,
      inputMint: review.inputMint,
      outputMint: review.outputMint,
      makingRaw: review.makingRaw,
      takingRaw: review.takingRaw,
      price: review.price,
      fillPrice: review.fillPrice,
      pool: review.pool,
      fee: { ryntraBps: review.fee.ryntraBps, venueBps: review.fee.venueBps, account: review.fee.account },
    },
  });
}

/** Build, sign and relay the cancellation (on DLMM also the claim) of one order. */
export async function signAndCancel(wallet: WalletRef, order: Readonly<{ venue: LimitVenue; order: string }>): Promise<Readonly<{ ok: true; value: SubmitAnswer }> | LimitCallFailure> {
  /* AG-1: a cancellation signed after its bytes' ~30 s is built again and signed once more, never sent dead. */
  type CancelBuild = Readonly<{ transactionBase64: string; requestId: string | null; signableMs?: number }>;
  const fresh = await signFreshBytes<CancelBuild, string, LimitCallFailure>({
    build: async () => {
      const answer = await post<CancelBuild>("/api/solana/limits/cancel", { owner: wallet.address, venue: order.venue, order: order.order });
      return answer.ok ? { ok: true as const, data: answer.value } : answer;
    },
    signableMsOf: (data) => data.signableMs,
    sign: async (data) => {
      const answer = await signTransaction({ wallet: wallet.wallet, address: wallet.address, unsignedWireBase64: data.transactionBase64, chain: "solana:mainnet" });
      return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
    },
  });
  if (!fresh.ok) {
    if (fresh.stage === "build") return fresh.failure;
    return fresh.stage === "sign" ? { ok: false, code: "WALLET_REFUSED", message: fresh.reason } : { ok: false, code: "REVIEW_AGED", message: "" };
  }
  const built = { value: fresh.built };
  const signed = { signedWireBase64: fresh.signed };
  return post<SubmitAnswer>("/api/solana/limits/submit", {
    kind: "cancel",
    venue: order.venue,
    owner: wallet.address,
    order: order.order,
    requestId: built.value.requestId,
    signedTransactionBase64: signed.signedWireBase64,
    terms: null,
  });
}

/**
 * A refusal in the person's words: the routes answer in English for logs, so
 * the screen speaks by the code; a code it does not know reads as the general
 * sentence for the step, never the route's English on a Ukrainian page.
 */
export function limitFailureText(failure: LimitCallFailure, text: (english: string) => string, general: string): string {
  switch (failure.code) {
    case "WALLET_REFUSED": return text("The wallet did not sign. Nothing was sent.");
    case "RATE_LIMITED": return text("Too many requests. Try again in a moment.");
    case "SWAP_PAUSED": return text("Trading is turned off right now.");
    case "BELOW_MINIMUM": return text("Jupiter takes limit orders from 5 USD.");
    case "CROSSES_MARKET": return text("This price is already the market: use a market order.");
    case "NO_LIMIT_POOL": case "NO_POOL": return text("No pool of this pair takes limits");
    case "SIMULATION_FAILED": return text("The network would refuse this order: check the balance and the SOL for fees.");
    case "NOT_CANCELLABLE": return text("This order is already closed or being closed.");
    case "NETWORK": return text("No answer from Ryntra. Nothing was sent.");
    default: return general;
  }
}
