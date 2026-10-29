"use client";

/**
 * Earn's calls from the browser, typed: what the page may read, the Review, the wallet's signature between
 * the Review and the relay, and the chain's word on a relay whose answer was lost on the way back.
 *
 * It carries and never decides. Whether an action is allowed, whether the market still matches the Review,
 * whether the signed bytes are the reviewed ones — every one of those is the server's, and this file would be
 * the wrong place to answer any of them even once.
 */

import { useEffect, useState } from "react";

import type { EarnSurface } from "@/lib/earn/actions";
import type { EarnReceipt } from "@/lib/earn/receipt";
import type { EarnReview } from "@/lib/earn/review";
import { MAX_SIGNABLE_WINDOW_MS, signableWindowClosed } from "@/lib/solana/blockhash-life";
import { signTransaction } from "@/lib/solana/wallet.client";

export type { EarnReceipt, EarnReview, EarnSurface };

export type Answer<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>;

async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
    });
    const json = (await response.json().catch(() => null)) as (T & { error?: { code?: string } }) | null;
    if (!response.ok || !json) return { ok: false, code: json?.error?.code ?? `HTTP_${response.status}` };
    return { ok: true, value: json };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

/**
 * The page's read, asked again when the wallet changes or an action finished.
 *
 * The server read that rendered the page carries the markets; this asks again with the wallet, because a
 * position belongs to a wallet that only the browser knows about. `version` is what a finished action bumps,
 * so the position on screen comes from the chain rather than from arithmetic over what just happened.
 */
export function useEarnSurface(initial: EarnSurface, owner: string | null, version: number): Readonly<{ surface: EarnSurface; reading: boolean }> {
  const [surface, setSurface] = useState(initial);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let live = true;
    setReading(true);
    void call<EarnSurface>(`/api/solana/earn${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`).then((answer) => {
      if (!live) return;
      setReading(false);
      if (answer.ok) setSurface(answer.value);
    });
    return () => {
      live = false;
    };
  }, [owner, version]);
  return { surface, reading };
}

export function reviewEarn(body: Readonly<{ provider: string; action: "deposit" | "withdraw"; owner: string; market: string; amount: string }>): Promise<Answer<EarnReview>> {
  return call<EarnReview>("/api/solana/earn/review", { method: "POST", body: JSON.stringify(body) });
}

/** How long these bytes may still be signed for, as the Review measured it on the chain. */
export function signableMsOf(review: EarnReview): number {
  return Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

/**
 * The wallet signs, then the server relays — and the server asks the market again before it does.
 *
 * Two things this file does decide, both about time. A wallet is not opened on bytes whose window has gone
 * (the page asks {@link mayOpenWallet} first), and a wallet that came back after the window closed does not
 * reach the relay: `REVIEW_AGED` asks for fresh bytes instead of sending bytes the chain would refuse.
 * Everything else — whether the market still matches the Review, whether the signed bytes are the reviewed
 * ones — is the server's, and a wallet that refused is this file's only other answer, because the server
 * never saw it.
 */
export async function signAndRelay(
  wallet: Readonly<{ wallet: string; address: string }>,
  review: EarnReview,
  receivedAtMs: number,
): Promise<Answer<EarnReceipt>> {
  const signed = await signTransaction({
    wallet: wallet.wallet,
    address: wallet.address,
    unsignedWireBase64: review.transaction.wireBase64,
    chain: "solana:mainnet",
  });
  if (!signed.ok) return { ok: false, code: "WALLET_REFUSED" };
  if (signableWindowClosed({ receivedAtMs, signableMs: signableMsOf(review) })) return { ok: false, code: "REVIEW_AGED" };
  return call<EarnReceipt>("/api/solana/earn/submit", {
    method: "POST",
    body: JSON.stringify({ ticket: review.ticket, signed: signed.signedWireBase64 }),
  });
}

/** How long a receipt keeps asking the chain how its transaction ended. */
export const FOLLOW_MS = 120_000;
const FOLLOW_EVERY_MS = 4_000;

/**
 * A receipt that the chain has not answered for yet, followed until it has.
 *
 * The one state this exists for is a signature that was sent and whose answer was lost: a person is never
 * told nothing happened when a signature of theirs is on the chain.
 */
export function useFollowedReceipt(receipt: EarnReceipt): EarnReceipt {
  const [current, setCurrent] = useState(receipt);
  useEffect(() => {
    setCurrent(receipt);
    if (receipt.state !== "UNKNOWN") return;
    let live = true;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const answer = await call<{ results: readonly Readonly<{ signature: string; state: EarnReceipt["state"]; reason: string | null }>[] }>(
        `/api/solana/earn/status?signatures=${encodeURIComponent(receipt.signature)}`,
      );
      if (!live) return;
      const seen = answer.ok ? answer.value.results[0] : null;
      if (seen && seen.state !== "UNKNOWN") {
        setCurrent({ ...receipt, state: seen.state, reason: seen.reason });
        return;
      }
      if (Date.now() - started < FOLLOW_MS) timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS);
    };
    timer = setTimeout(() => void tick(), FOLLOW_EVERY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [receipt]);
  return current;
}
