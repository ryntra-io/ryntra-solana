/**
 * Ryntra's fee in the Exchange, executor by executor.
 *
 * One rule, carried through each executor's own mechanism — no fee contract of
 * Ryntra's, no extra transfer:
 *
 * | Executor | Ryntra's rate | Parameter | Where it lands |
 * |---|---|---|---|
 * | Jupiter (same network) | the flow's tariff, fee policy v2 — 0.10 % majors, 0.50 % trending, 1 % memes, 0 dollar to dollar | `platformFeeBps` + `feeAccount` on `/build`, or `referralAccount` + `referralFee` on `/order` | the fee wallet's token account in the swap itself; Jupiter keeps a fifth of a referral |
 * | Manifest (same network, the order book alone) | the same tariff | `platformFeeBps` + `feeAccount` on `/build` with `dexes=Manifest` | the fee wallet's token account in the swap itself |
 * | Relay (across networks) | 25 bps | `appFees: [{recipient, fee}]` | Relay's app balance in USDC for Ryntra's EVM claim address |
 * | deBridge (across networks) | 25 bps | `affiliateFeePercent` + `affiliateFeeRecipient` | accrues in the DLN program for Ryntra's Solana key, withdrawn by that key |
 * | Mayan (across networks) | 25 bps | `referrer` + `referrerBps` | on chain to Ryntra's Solana referrer address |
 *
 * The cross-network rate is one number for all three (рішення 11: «наша комісія
 * 25 bps на кросчейн»), so the executor that wins does so on its own price.
 * Pure and client-safe.
 */

import { RYNTRA_SERVICE_FEE_POLICY } from "../swap/service-fee.ts";

/** Рішення 11: Ryntra's fee on an exchange across networks, whoever carries it. */
export const CROSS_NETWORK_FEE_BPS = 25;

/** deBridge's affiliate rate, the cross-network one; Relay and Mayan keep theirs in `RYNTRA_SERVICE_FEE_POLICY`, which says the same. */
export const DEBRIDGE_AFFILIATE_FEE_BPS = CROSS_NETWORK_FEE_BPS;

/* The two rates already in force must agree with the rule; a test pins it, and so does this line at load time. */
if (RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE !== CROSS_NETWORK_FEE_BPS || RYNTRA_SERVICE_FEE_POLICY.MAYAN_REFERRER !== CROSS_NETWORK_FEE_BPS) {
  throw new Error("The cross-network fee must be one rate for every executor (рішення 11).");
}

/** Where each executor pays Ryntra, as a person checking a receipt would look for it. */
export const EXCHANGE_FEE_DESTINATION = {
  Jupiter: "Ryntra's fee wallet, in the swap itself",
  Manifest: "Ryntra's fee wallet, in the swap itself",
  Relay: "Ryntra's Relay app balance (USDC), for its EVM claim address",
  deBridge: "the DLN program, withdrawn by Ryntra's Solana key",
  Mayan: "Ryntra's Solana referrer address, on chain",
} as const;

/**
 * Ryntra's receiving addresses for the executors across networks. All public:
 * nothing here can spend a fee, only receive or claim one.
 */
export type ExchangeFeeConfig = Readonly<{
  relayAppFeeRecipient: string | null;
  debridgeAffiliateSolana: string | null;
  mayanReferrerSolana: string | null;
}>;

const SOLANA_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A value of the wrong shape is no address: that executor then quotes without Ryntra's fee and says so. */
export function normalizeExchangeFeeConfig(raw: Readonly<Record<keyof ExchangeFeeConfig, string | null | undefined>>): ExchangeFeeConfig {
  const solana = (value: string | null | undefined) => (value && SOLANA_KEY.test(value.trim()) ? value.trim() : null);
  const evm = (value: string | null | undefined) => (value && EVM_ADDRESS.test(value.trim()) ? value.trim() : null);
  return {
    relayAppFeeRecipient: evm(raw.relayAppFeeRecipient),
    debridgeAffiliateSolana: solana(raw.debridgeAffiliateSolana),
    mayanReferrerSolana: solana(raw.mayanReferrerSolana),
  };
}
