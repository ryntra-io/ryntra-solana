"use client";

/**
 * The order panel's calls, typed (B6b): whether the wallet may place orders now, the Review, the wallet's signature
 * between the Review and the relay, and the chain's word — with Phoenix's record of the fills — on a relay whose answer
 * was lost or came before the fills. The collateral's carrier (`collateral-api.ts`) for an order. The routes decide;
 * this file only carries.
 */

import { useEffect, useState } from "react";

import { orderRelayAfterSigning, type OrderRelay, type OrderReview, type OrderStates, type PerpTif } from "@/lib/phoenix/orders-model";
import { MAX_SIGNABLE_WINDOW_MS, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { signTransactions } from "@/lib/solana/wallet.client";

import { signatureOfCollateralWire, walletSignsV1 } from "./collateral-api";

export type { OrderRelay, OrderReview, OrderStates };
export { walletSignsV1 };

type Answer<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>;

async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { cache: "no-store", ...init, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) } });
    const json = (await response.json().catch(() => null)) as (T & { error?: { code?: string } }) | null;
    if (!response.ok || !json) return { ok: false, code: json?.error?.code ?? `HTTP_${response.status}` };
    return { ok: true, value: json };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

const CLOSED: OrderStates = { open: false, maxNotionalUsd: null, builder: false };

/** Whether this wallet may place orders now; closed until the server says otherwise. */
export function useOrderStates(owner: string | null): OrderStates {
  const [states, setStates] = useState<OrderStates>(CLOSED);
  useEffect(() => setStates(CLOSED), [owner]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /* An answer that did not come is asked again — three times, five seconds apart — never left as «closed». */
    const ask = (left: number) =>
      void call<OrderStates>(`/api/solana/futures/orders${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`).then((answer) => {
        if (!live) return;
        if (answer.ok) setStates(answer.value);
        else if (left > 0) timer = setTimeout(() => ask(left - 1), 5_000);
      });
    ask(3);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [owner]);
  return states;
}

/** The order as the route takes it: lots and ticks as digits, never a float. */
export type OrderBody =
  | Readonly<{ kind: "open"; owner: string; symbol: string; side: "long" | "short"; type: "market" | "limit"; tif?: PerpTif; size: string; price?: string; slippageBps?: number; tp?: string | null; sl?: string | null; format?: "v1" }>
  | Readonly<{ kind: "reduce"; owner: string; symbol: string; size: string; close?: boolean; slippageBps?: number; format?: "v1" }>
  | Readonly<{ kind: "protect"; owner: string; symbol: string; tp: string | null; sl: string | null; format?: "v1" }>
  | Readonly<{ kind: "cancel"; owner: string; symbol: string; order: string; format?: "v1" }>
  | Readonly<{ kind: "cancelAll"; owner: string; symbol: string; format?: "v1" }>
  | Readonly<{ kind: "cancelConditional"; owner: string; symbol: string; index: number; format?: "v1" }>;

export function reviewOrder(body: OrderBody): Promise<Answer<OrderReview>> {
  return call<OrderReview>("/api/solana/futures/orders/review", { method: "POST", body: JSON.stringify(body) });
}

export function signableMsOfOrder(review: OrderReview): number {
  return Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

/**
 * The wallet signs, then the relay sends — unless the bytes aged out while the wallet was open: then nothing is sent and
 * `REVIEW_AGED` asks for a fresh Review. Once the wallet has signed, a lost answer is never «nothing was sent».
 *
 * `onSigned` is called with the signature the moment the wallet has signed and the bytes go to the relay, so the screen
 * can show that step for the up-to-forty seconds the relay takes to send them and wait for the landing (PERP-5, spec
 * §10 step 3). It says the wallet signed and the bytes are on their way — not that Solana has them: the relay may still
 * refuse before sending (an aged ticket, a closed gate, a rate limit), and then nothing was sent at all. «The position
 * is open» waits for the chain's own word, two steps further on.
 */
export async function signAndRelayOrder(
  wallet: Readonly<{ wallet: string; address: string }>,
  review: OrderReview,
  receivedAtMs: number,
  onSigned?: (signature: string) => void,
): Promise<Answer<OrderRelay>> {
  const signed = await signTransactions({ wallet: wallet.wallet, address: wallet.address, unsignedWireBase64: [review.transaction.wireBase64], chain: "solana:mainnet" });
  if (!signed.ok) return { ok: false, code: "WALLET_REFUSED" };
  if (signableWindowClosed({ receivedAtMs, signableMs: signableMsOfOrder(review) })) return { ok: false, code: "REVIEW_AGED" };
  const signatures = signed.signedWireBase64.map(signatureOfCollateralWire);
  if (signatures[0]) onSigned?.(signatures[0]);
  const relayed = await call<OrderRelay>("/api/solana/futures/orders/submit", { method: "POST", body: JSON.stringify({ ticket: review.ticket, signed: signed.signedWireBase64 }) });
  return orderRelayAfterSigning(relayed, signatures);
}

/** How long the relay takes at most — the send and then the wait for the landing (the server's own `RELAY_MS`). */
export const ORDER_SENT_MS = 40_000;

export const ORDER_FOLLOW_MS = 120_000;
const FOLLOW_EVERY_MS = 4_000;

/* Still to read: how it ended, or — landed, for an order that trades now — Phoenix's record of what it filled. */
const unsettledFor = (expectsFills: boolean) => (result: OrderRelay["results"][number]) => result.state === "UNKNOWN" || (expectsFills && result.state === "LANDED" && result.fills == null);

/**
 * A relay as the chain and Phoenix see it: the relay's answer, then their word every few seconds for two minutes. An
 * order that trades now (a market order, a cut, a close) waits for its fills too; a resting limit, TP/SL and a cancel
 * fill nothing to wait for.
 */
export function useFollowedOrderRelay(relay: OrderRelay, owner: string, expectsFills: boolean): OrderRelay {
  const [current, setCurrent] = useState(relay);
  useEffect(() => {
    const unsettled = unsettledFor(expectsFills);
    setCurrent(relay);
    if (!relay.results.some(unsettled)) return;
    let live = true;
    const started = Date.now();
    const signatures = relay.results.map((result) => result.signature).join(",");
    const tick = async () => {
      const answer = await call<{ results: OrderRelay["results"] }>(`/api/solana/futures/orders/status?owner=${encodeURIComponent(owner)}&signatures=${encodeURIComponent(signatures)}`);
      if (!live) return;
      if (answer.ok) {
        const results = relay.results.map((result, index) => {
          const seen = answer.value.results[index];
          if (!seen || seen.state === "UNKNOWN") return result;
          const fills = seen.fills ?? result.fills;
          return { ...result, state: seen.state, reason: seen.reason, ...(fills === undefined ? {} : { fills }) };
        });
        setCurrent({ results, settled: results.every((result) => result.state === "LANDED") });
        if (!results.some(unsettled)) return;
      }
      if (Date.now() - started < ORDER_FOLLOW_MS) timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS);
    };
    let timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [relay, owner, expectsFills]);
  return current;
}
