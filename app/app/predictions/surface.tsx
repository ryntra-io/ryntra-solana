"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * What the prediction pages need from the shell around them, and nothing
 * else: where their own pages live, and the wallet the person signs with.
 *
 * Neither the path nor the wallet is written into a component: the Solana
 * app's shell provides both — the section's address and the wallet from its
 * own connection — so the pages draw the same wherever that shell puts them.
 */

export type PredictionsPaths = Readonly<{
  /** The hub; every event page is under it. */
  hub: string;
  event: (eventId: string) => string;
  /** The paper portfolio page, when the shell has one. */
  portfolio: string | null;
  /** Where the person's saved plans are listed. */
  plans: string | null;
}>;

/** The section's address in the Solana app. */
export const CABINET_BASE = "/app/predictions";

export function predictionsPaths(base: string, portfolio: string | null, plans: string | null): PredictionsPaths {
  const hub = base.replace(/\/+$/, "") || "/";
  return { hub, event: (eventId) => `${hub === "/" ? "" : hub}/${encodeURIComponent(eventId)}`, portfolio, plans };
}

const PathsContext = createContext<PredictionsPaths>(predictionsPaths(CABINET_BASE, null, "/app/strategies"));

export function PredictionsPathsProvider({ base, portfolio = null, plans = null, children }: { base: string; portfolio?: string | null; plans?: string | null; children: ReactNode }) {
  const value = useMemo(() => predictionsPaths(base, portfolio, plans), [base, portfolio, plans]);
  return <PathsContext.Provider value={value}>{children}</PathsContext.Provider>;
}

export function usePredictionsPaths(): PredictionsPaths {
  return useContext(PathsContext);
}

export type WalletSignature =
  | Readonly<{ ok: true; signature: string; encoding: "base64" }>
  | Readonly<{ ok: false; code: string; reason: string }>;

export type PredictionsWallet = Readonly<{
  /** The wallet the browser holds now, or null. */
  address: string | null;
  chain: "solana" | null;
  /** Whether the server holds a proof for exactly this wallet. */
  proven: boolean;
  /** Prove the held wallet to the server (one signature); true when proven. */
  prove: () => Promise<boolean>;
  /** Sign a text the server built, verbatim, with the held wallet. */
  sign: (message: string) => Promise<WalletSignature>;
  /** Open the shell's own wallet choice, when the shell has one. */
  connect: (() => void) | null;
}>;

const NO_WALLET: PredictionsWallet = {
  address: null,
  chain: null,
  proven: false,
  prove: async () => false,
  sign: async () => ({ ok: false, code: "NO_WALLET", reason: "" }),
  connect: null,
};

const WalletContext = createContext<PredictionsWallet>(NO_WALLET);

export function PredictionsWalletProvider({ wallet, children }: { wallet: PredictionsWallet; children: ReactNode }) {
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function usePredictionsWallet(): PredictionsWallet {
  return useContext(WalletContext);
}
