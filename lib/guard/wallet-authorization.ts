import type { z } from "zod";

import type { ExecutionFingerprintSchema } from "./contracts.ts";

/**
 * The kernel's port for a wallet-signed authorization.
 *
 * `authorize` with the method `EIP712` records a human approval only when the
 * wallet bound to the intent has signed that exact intent, evaluation and
 * execution fingerprint. What such a signature looks like — its typed-data
 * domain, its chain, how it is checked — belongs to the network that serves
 * it, not to the kernel; the kernel asks this port and stores the reference it
 * returns, never the signature.
 *
 * The network's module registers its verifier when it is imported, and the
 * entry points that serve that network import it. A service can also be given
 * a verifier directly (`createGuardService({ walletAuthorization })`), which is
 * how tests pin one. With neither, a wallet-signed authorization is refused as
 * unavailable rather than accepted unchecked.
 */
export type WalletAuthorizationInput = {
  intentId: string;
  evaluationId: string;
  fingerprint: z.infer<typeof ExecutionFingerprintSchema>;
  signature: `0x${string}`;
  audience: string;
};

export type WalletAuthorizationVerifier = {
  /** True only when the signature authorizes this exact intent, evaluation and fingerprint for the bound wallet. */
  verify(input: WalletAuthorizationInput): Promise<boolean>;
  /** A non-secret reference stored in place of the signature. */
  signatureRef(signature: `0x${string}`): string;
};

/* Process-wide, like the runtime: Next.js can load this module more than once
   in one process (route handlers and server components are bundled apart), and
   a verifier registered through one copy must be visible through every other. */
const registry = globalThis as typeof globalThis & {
  __ryntraKernelWalletAuthorization?: WalletAuthorizationVerifier;
};

export function registerWalletAuthorizationVerifier(verifier: WalletAuthorizationVerifier): void {
  registry.__ryntraKernelWalletAuthorization = verifier;
}

export function registeredWalletAuthorizationVerifier(): WalletAuthorizationVerifier | null {
  return registry.__ryntraKernelWalletAuthorization ?? null;
}
