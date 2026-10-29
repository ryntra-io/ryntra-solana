"use client";

/**
 * The pool action screens' calls, typed: what the wallet may do now, the
 * Review, the wallet's signature between the Review and the relay, and the
 * chain's word on a relay whose answer was lost. The routes decide; this file
 * only carries.
 */

import type { CapabilityState } from "@ryntra/core/adapters";
import { useEffect, useState } from "react";

import type { LiquidityRelay, LiquidityReview } from "@/lib/liquidity/studio/actions";
import { MAX_SIGNABLE_WINDOW_MS, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { signTransactions } from "@/lib/solana/wallet.client";

export type { LiquidityRelay, LiquidityReview };

export type ActionStates = Readonly<{ add: CapabilityState; remove: CapabilityState; claim: CapabilityState; maxDepositUsd: number | null }>;

export type CallFailure = Readonly<{ ok: false; code: string }>;
type Answer<T> = Readonly<{ ok: true; value: T }> | CallFailure;

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

const CLOSED: ActionStates = { add: { status: "later", until: "after a live check" }, remove: { status: "later", until: "after a live check" }, claim: { status: "later", until: "after a live check" }, maxDepositUsd: null };

/** What this wallet may do on a pool now; closed until the server says otherwise. */
export function useActionStates(owner: string | null): ActionStates {
  const [states, setStates] = useState<ActionStates>(CLOSED);
  useEffect(() => {
    let live = true;
    setStates(CLOSED);
    void call<ActionStates>(`/api/liquidity/actions${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`).then((answer) => {
      if (live && answer.ok) setStates(answer.value);
    });
    return () => {
      live = false;
    };
  }, [owner]);
  return states;
}

export type ReviewBody =
  | Readonly<{
      action: "add";
      venue: string;
      request: Readonly<{ pool: string; owner: string; position?: string; amountX: string; amountY: string; shape?: string; slippageBps: number }>;
      /** DLMM: where and how wide, counted by the server from the active bin it reads. */
      range?: Readonly<{ place: "around" | "above" | "below"; half: number }>;
    }>
  | Readonly<{ action: "remove"; venue: string; request: Readonly<{ position: string; owner: string; shareBps: number; close: boolean; slippageBps: number }> }>
  | Readonly<{ action: "claim"; venue: string; request: Readonly<{ position: string; owner: string }> }>;

export function reviewAction(body: ReviewBody): Promise<Answer<LiquidityReview>> {
  return call<LiquidityReview>("/api/liquidity/review", { method: "POST", body: JSON.stringify(body) });
}

/**
 * The relay answers a refusal only before its first send — once a byte has left it always answers with the results. So
 * a refusal it worded means nothing moved; only no answer (the connection dropped, or a gateway's page in place of the
 * route's) leaves the outcome to the chain.
 */
const unanswered = (code: string) => code === "NETWORK" || /^HTTP_5\d\d$/.test(code);

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

/** A signed legacy transaction's id: its first signature (after the one-byte count every pool action has). */
export function signatureOfWire(wireBase64: string): string {
  const bytes = Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
  return base58(bytes.subarray(1, 65));
}

/**
 * Sign the reviewed transactions in one prompt and hand the bytes to the relay. Once the wallet has signed, a lost or
 * failed answer is never «nothing was sent»: unless the relay refused before sending, the receipt waits on the chain.
 */
/** How long from arriving a Review's bytes may still be signed; a server from before 2026-10-17 sent no figure. */
export function signableMsOf(review: LiquidityReview): number {
  return Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

/**
 * The wallet signs, then the relay sends — unless the bytes aged out while the wallet was open (~30 s of life,
 * `lib/solana/blockhash-life.ts`). Then nothing is sent: `REVIEW_AGED` asks the screen for a fresh Review, and the
 * signed bytes, which nobody else holds, die with their blockhash.
 */
export async function signAndRelay(wallet: Readonly<{ wallet: string; address: string }>, review: LiquidityReview, receivedAtMs: number): Promise<Answer<LiquidityRelay>> {
  const signed = await signTransactions({ wallet: wallet.wallet, address: wallet.address, unsignedWireBase64: review.transactions.map((tx) => tx.wireBase64), chain: "solana:mainnet" });
  if (!signed.ok) return { ok: false, code: "WALLET_REFUSED" };
  if (signableWindowClosed({ receivedAtMs, signableMs: signableMsOf(review) })) return { ok: false, code: "REVIEW_AGED" };
  const relayed = await call<LiquidityRelay>("/api/liquidity/submit", { method: "POST", body: JSON.stringify({ ticket: review.ticket, signed: signed.signedWireBase64 }) });
  if (relayed.ok || !unanswered(relayed.code)) return relayed;
  return { ok: true, value: { results: signed.signedWireBase64.map((wire) => ({ signature: signatureOfWire(wire), state: "UNKNOWN" as const, reason: null })), settled: false } };
}

/** How long a receipt keeps asking the chain about a relay it has no answer for. */
const FOLLOW_MS = 120_000;
const FOLLOW_EVERY_MS = 4_000;

/**
 * A relay as the chain sees it: what the relay answered, then — while any transaction is unread — the chain's word,
 * asked every few seconds for two minutes. A transaction after an unread one stays «not sent» unless the chain has it.
 */
export function useFollowedRelay(relay: LiquidityRelay): LiquidityRelay {
  const [current, setCurrent] = useState(relay);
  useEffect(() => {
    setCurrent(relay);
    if (!relay.results.some((result) => result.state === "UNKNOWN")) return;
    let live = true;
    const started = Date.now();
    const signatures = relay.results.map((result) => result.signature).join(",");
    const tick = async () => {
      const answer = await call<{ results: LiquidityRelay["results"] }>(`/api/liquidity/status?signatures=${encodeURIComponent(signatures)}`);
      if (!live) return;
      if (answer.ok) {
        const results = relay.results.map((result, index) => {
          const seen = answer.value.results[index];
          if (!seen || seen.state === "UNKNOWN") return result;
          return { ...result, state: seen.state, reason: seen.reason };
        });
        const next = { results, settled: results.every((result) => result.state === "LANDED") };
        setCurrent(next);
        if (!results.some((result) => result.state === "UNKNOWN")) return;
      }
      if (Date.now() - started < FOLLOW_MS) timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS);
    };
    let timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [relay]);
  return current;
}
