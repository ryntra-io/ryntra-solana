/**
 * The adapter manifest — the one place a new network is wired in.
 *
 * The central schema sources (`contracts.ts`, `registry.ts`) must never name
 * a provider again: the no-central-edit test reads them from disk and fails
 * on the name. So the shipped registry spreads this list, and adding a
 * network is exactly two changes — the adapter's own module, and one line
 * here. This file is the extension surface, deliberately outside the central
 * set; a manifest that lists its members is the point, not a leak.
 */

import { A2A_DEFINITIONS } from "./a2a.ts";
import { BASE_EVM_DEFINITIONS } from "./base-evm.ts";
import { JUPITER_SWAP_DEFINITIONS } from "./jupiter-swap.ts";
import { SOLANA_TOKEN_2022_DEFINITIONS } from "./solana-token-2022.ts";
import { X402_PAYMENT_DEFINITIONS } from "./x402-payments.ts";

export const REGISTERED_ADAPTER_DEFINITIONS: readonly unknown[] = [
  ...SOLANA_TOKEN_2022_DEFINITIONS,
  ...JUPITER_SWAP_DEFINITIONS,
  ...BASE_EVM_DEFINITIONS,
  ...X402_PAYMENT_DEFINITIONS,
  ...A2A_DEFINITIONS,
];
