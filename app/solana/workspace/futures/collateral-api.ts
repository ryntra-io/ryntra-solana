"use client";

/**
 * The collateral panel's calls, typed (B6): what the wallet may do now, the Review, the wallet's signature between the
 * Review and the relay, and the chain's word on a relay whose answer was lost — the pools' carrier
 * (`app/app/markets/pools/liquidity-api.ts`) for one transaction. The routes decide; this file only carries.
 */

import { useEffect, useState } from "react";

import type { CollateralReview } from "@/lib/phoenix/collateral-actions";
import { relayAfterSigning, type CollateralRelay } from "@/lib/phoenix/collateral-model";
import type { CollateralStates } from "@/lib/phoenix/collateral.server";
import { MAX_SIGNABLE_WINDOW_MS, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { signTransactions, walletSignsV1 } from "@/lib/solana/wallet.client";
import { signatureOfWire } from "@/app/app/markets/pools/liquidity-api";

export type { CollateralRelay, CollateralReview, CollateralStates };

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

const CLOSED: CollateralStates = { deposit: false, withdraw: false, maxMicro: null, maxDeposit: null, walletUsdc: null };

/** What this wallet may do now and the USDC it holds; closed until the server says otherwise. `version` asks again. */
export function useCollateralStates(owner: string | null, version: number): CollateralStates {
  const [states, setStates] = useState<CollateralStates>(CLOSED);
  /* Another wallet starts closed: the last one's balance never fills this one's «Max». */
  useEffect(() => setStates(CLOSED), [owner]);
  useEffect(() => {
    let live = true;
    void call<CollateralStates>(`/api/solana/futures/collateral${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`).then((answer) => {
      if (live && answer.ok) setStates(answer.value);
    });
    return () => {
      live = false;
    };
  }, [owner, version]);
  return states;
}

export { walletSignsV1 };

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

/**
 * A signed transaction's id, either format: v1 puts the signatures at the tail, one per signer (the header's first byte
 * after the version), the first the wallet's; legacy keeps the pools' reading.
 */
export function signatureOfCollateralWire(wireBase64: string): string {
  const bytes = Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
  if (bytes[0] !== 0x81) return signatureOfWire(wireBase64);
  const signers = bytes[1] ?? 1;
  const start = bytes.length - signers * 64;
  return base58(bytes.subarray(start, start + 64));
}

export function reviewCollateral(body: Readonly<{ action: "deposit" | "withdraw"; owner: string; amount: string; format?: "v1" }>): Promise<Answer<CollateralReview>> {
  return call<CollateralReview>("/api/solana/futures/collateral/review", { method: "POST", body: JSON.stringify(body) });
}

/** How long from arriving a Review's bytes may still be signed. */
export function signableMsOf(review: CollateralReview): number {
  return Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

/**
 * The wallet signs, then the relay sends — unless the bytes aged out while the wallet was open: then nothing is sent and
 * `REVIEW_AGED` asks for a fresh Review. Once the wallet has signed, a lost answer is never «nothing was sent»: the
 * receipt waits on the chain.
 */
export async function signAndRelay(wallet: Readonly<{ wallet: string; address: string }>, review: CollateralReview, receivedAtMs: number): Promise<Answer<CollateralRelay>> {
  const signed = await signTransactions({ wallet: wallet.wallet, address: wallet.address, unsignedWireBase64: [review.transaction.wireBase64], chain: "solana:mainnet" });
  if (!signed.ok) return { ok: false, code: "WALLET_REFUSED" };
  if (signableWindowClosed({ receivedAtMs, signableMs: signableMsOf(review) })) return { ok: false, code: "REVIEW_AGED" };
  const relayed = await call<CollateralRelay>("/api/solana/futures/collateral/submit", { method: "POST", body: JSON.stringify({ ticket: review.ticket, signed: signed.signedWireBase64 }) });
  return relayAfterSigning(relayed, signed.signedWireBase64.map(signatureOfCollateralWire));
}

export const FOLLOW_MS = 120_000;

/* Still to read from the chain: how it ended, or — landed — the USDC it moved, which a receipt states rather than the Review's figure. */
const unsettled = (result: CollateralRelay["results"][number]) => result.state === "UNKNOWN" || (result.state === "LANDED" && result.usdcMoved == null);
const FOLLOW_EVERY_MS = 4_000;

/** A relay as the chain sees it: the relay's answer, then — while unread, or landed without its figure — the chain's word every few seconds for two minutes. */
export function useFollowedRelay(relay: CollateralRelay): CollateralRelay {
  const [current, setCurrent] = useState(relay);
  useEffect(() => {
    setCurrent(relay);
    if (!relay.results.some(unsettled)) return;
    let live = true;
    const started = Date.now();
    const signatures = relay.results.map((result) => result.signature).join(",");
    const tick = async () => {
      const answer = await call<{ results: CollateralRelay["results"] }>(`/api/solana/futures/collateral/status?signatures=${encodeURIComponent(signatures)}`);
      if (!live) return;
      if (answer.ok) {
        const results = relay.results.map((result, index) => {
          const seen = answer.value.results[index];
          if (!seen || seen.state === "UNKNOWN") return result;
          const usdcMoved = seen.usdcMoved ?? result.usdcMoved;
          return { ...result, state: seen.state, reason: seen.reason, ...(usdcMoved === undefined ? {} : { usdcMoved }) };
        });
        setCurrent({ results, settled: results.every((result) => result.state === "LANDED") });
        if (!results.some(unsettled)) return;
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
