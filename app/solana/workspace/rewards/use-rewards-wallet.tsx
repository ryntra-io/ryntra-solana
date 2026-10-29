"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { revalidateWalletFact } from "@/lib/account/wallet-proof-store.client";

import { useSolanaConnection } from "../connection.tsx";
import { useWalletFact, useWalletProof } from "../wallet-proof.tsx";
import { proofKey, REFUSAL_WINDOW_MS, refusalVerdict, rewardsWallet, type RefusalVerdict, type RewardsWallet } from "./rewards-wallet.ts";

/**
 * The wallet every Rewards page is about, with the proof the sign-in already gave (`rewards-wallet.ts`). One hook for
 * the overview, the boards, the season, partners and the kit, so no page asks the wallet on its own.
 *
 * `signIn()` is the one signature a connected wallet that never signed in is asked for — the same sign-in as the
 * header's (`useWalletProof().prove()` picks it: a sign-in for a person with no account, the wallet's proof for a
 * person signed in by email or Google). `refused(address)` is what a page calls when the server refused a proven
 * read: the shared fact is asked again and the answer says what to do (`refusalVerdict`) — read once more, follow the
 * fact, or remember the refusal. Refusals live in one store for the tab, so every Rewards block on a page agrees.
 */

const refusedProofs = new Set<string>();
const strikes = new Map<string, number[]>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => version;

/** A proven read the server answered: the blinks counted against this wallet's proof are forgotten. */
function served(address: string): void {
  for (const key of strikes.keys()) if (key.startsWith(`${address}|`)) strikes.delete(key);
}

/** Tests only: a fresh tab. */
export function forgetRefusalsForTests(): void {
  refusedProofs.clear();
  strikes.clear();
  changed();
}

export function useRewardsWallet() {
  const { connection } = useSolanaConnection();
  const fact = useWalletFact();
  const proof = useWalletProof();
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const connected = connection?.address ?? null;
  const address = connected ?? fact.provenAddress;
  const refusedKey = address && refusedProofs.has(proofKey(address, fact)) ? proofKey(address, fact) : null;
  const wallet: RewardsWallet = rewardsWallet(connected, fact, refusedKey);
  /* The proof hook hands out new functions every render; the pages' loaders depend on these two staying put. */
  const latest = useRef({ proof, fact });
  useEffect(() => {
    latest.current = { proof, fact };
  });

  const refused = useCallback(async (asked: string, options: Readonly<{ count?: boolean }> = {}): Promise<RefusalVerdict> => {
    const fresh = await revalidateWalletFact();
    /* Keyed by the proof as the server describes it now, so a seed without its expiry and the fresh answer agree. */
    const key = proofKey(asked, fresh);
    const earlier = strikes.get(key) ?? [];
    const now = Date.now();
    const verdict = refusalVerdict(asked, fresh, earlier, now, options.count !== false);
    if (verdict === "retry") strikes.set(key, [...earlier.filter((at) => now - at < REFUSAL_WINDOW_MS), now]);
    if (verdict === "refused") {
      refusedProofs.add(key);
      changed();
    }
    return verdict;
  }, []);

  const signIn = useCallback(async () => {
    const ok = await latest.current.proof.prove();
    if (ok) {
      refusedProofs.clear();
      strikes.clear();
      changed();
    }
    return ok;
  }, []);

  const state = proof.state;
  return {
    ...wallet,
    open: wallet.gate === "open",
    signIn,
    refused,
    served,
    signing: state.status === "signing",
    failure: state.status === "refused" || state.status === "failed" || state.status === "unsupported" || state.status === "taken" ? state.reason : null,
  };
}
