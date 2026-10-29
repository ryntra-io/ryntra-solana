/**
 * Where the three receiving addresses come from — server only.
 *
 * Split from `service-fee.ts` for the same reason `build.server.ts` is split
 * from its quote boundary: the model is imported by surfaces a browser loads,
 * and a module a browser may import is not a module that reads the environment.
 *
 * All three are **public receiving addresses**. Nothing here is a secret, and
 * nothing here is a key: Jupiter's referral account is a program account whose
 * partner authority is the founder's wallet, Relay's is a claim address that
 * proves ownership by signature at withdrawal time, and Mayan's is an ordinary
 * Solana address. This lane can therefore take a fee without ever holding
 * anything that could spend one.
 *
 * They are read from the environment rather than committed because they are
 * deployment facts, and because a wrong one must be changeable without a
 * release. A value of the wrong shape degrades to "no fee" — see
 * `normalizeServiceFeeConfig`.
 */

import { normalizeServiceFeeConfig, type ServiceFeeConfig } from "./service-fee.ts";

export const SERVICE_FEE_ENV = {
  jupiterReferralAccount: "RYNTRA_JUPITER_REFERRAL_ACCOUNT",
  relayAppFeeRecipient: "RYNTRA_RELAY_APP_FEE_RECIPIENT",
  mayanReferrerSolana: "RYNTRA_MAYAN_REFERRER_SOLANA",
} as const;

export function resolveServiceFeeConfig(env: NodeJS.ProcessEnv = process.env): ServiceFeeConfig {
  return normalizeServiceFeeConfig({
    jupiterReferralAccount: env[SERVICE_FEE_ENV.jupiterReferralAccount] ?? null,
    relayAppFeeRecipient: env[SERVICE_FEE_ENV.relayAppFeeRecipient] ?? null,
    mayanReferrerSolana: env[SERVICE_FEE_ENV.mayanReferrerSolana] ?? null,
  });
}

/*
 * There is deliberately **no** synchronous helper here that turns the configured
 * account into a `/order` parameter.
 *
 * A well-formed address that is not initialised under Jupiter's referral program
 * makes `/order` answer HTTP 400 and takes the whole Solana swap lane down — so
 * the account has to be proved against the chain before it is named, and that is
 * an async question. `lib/solana/referral-account.server.ts` owns it. A tempting
 * one-line sibling that skipped the proof is the exact mistake worth making
 * impossible to reach for.
 */
