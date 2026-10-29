/**
 * Ryntra's receiving addresses for the Exchange's executors — server only, read
 * from the environment by name. Relay's and Mayan's are the swap lane's own
 * (`lib/swap/service-fee.server.ts`); deBridge's is new with B9.
 */

import { SERVICE_FEE_ENV } from "../swap/service-fee.server.ts";
import { normalizeExchangeFeeConfig, type ExchangeFeeConfig } from "./fees.ts";

export const EXCHANGE_FEE_ENV = {
  relayAppFeeRecipient: SERVICE_FEE_ENV.relayAppFeeRecipient,
  /** A Solana public key of Ryntra's: deBridge's affiliate fee from a Solana origin accrues to it and is withdrawn by it. */
  debridgeAffiliateSolana: "RYNTRA_DEBRIDGE_AFFILIATE_SOLANA",
  mayanReferrerSolana: SERVICE_FEE_ENV.mayanReferrerSolana,
} as const;

export function resolveExchangeFeeConfig(env: NodeJS.ProcessEnv = process.env): ExchangeFeeConfig {
  return normalizeExchangeFeeConfig({
    relayAppFeeRecipient: env[EXCHANGE_FEE_ENV.relayAppFeeRecipient] ?? null,
    debridgeAffiliateSolana: env[EXCHANGE_FEE_ENV.debridgeAffiliateSolana] ?? null,
    mayanReferrerSolana: env[EXCHANGE_FEE_ENV.mayanReferrerSolana] ?? null,
  });
}
