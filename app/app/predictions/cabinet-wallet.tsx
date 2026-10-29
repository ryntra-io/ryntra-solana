"use client";

import { useMemo, type ReactNode } from "react";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { bytesToBase64, signMessageWithWallet } from "@/lib/solana/wallet-signin.client";

import { PredictionsWalletProvider, type PredictionsWallet } from "./surface";

/**
 * The cabinet's Solana wallet, handed to the prediction pages: the wallet
 * the cabinet's top bar connected and the proof it already holds. Inside the
 * cabinet the person connects and proves through the cabinet's own control,
 * so this wallet opens no choice of its own.
 */
export function CabinetPredictionsWallet({ children }: { children: ReactNode }) {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const prove = proof.prove;

  const wallet = useMemo<PredictionsWallet>(
    () => ({
      address,
      chain: address ? "solana" : null,
      proven,
      prove: async () => Boolean(await prove()),
      sign: async (message) => {
        if (!connection) return { ok: false, code: "NO_WALLET", reason: "" };
        const signed = await signMessageWithWallet(connection.wallet, connection.address, message);
        return signed.ok ? { ok: true, signature: bytesToBase64(signed.signature), encoding: "base64" } : { ok: false, code: signed.state, reason: signed.reason };
      },
      connect: null,
    }),
    [address, proven, prove, connection],
  );

  return <PredictionsWalletProvider wallet={wallet}>{children}</PredictionsWalletProvider>;
}
