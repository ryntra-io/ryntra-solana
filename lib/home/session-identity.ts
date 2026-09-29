/**
 * Project authentication identity separately from legacy watch data.
 *
 * A Telegram session proves the Telegram subject and no wallet. A wallet
 * session proves exactly the SIWE subject. The legacy watch address remains
 * visible as data-selection compatibility and can never fill the identity slot.
 */
export type SessionIdentity = Readonly<{
  subjectKind: "TELEGRAM" | "WALLET";
  identityWallet: string | null;
  legacyWatchAddress: string | null;
  walletOwnership: "PROVEN_BY_SIWE" | "NOT_PROVEN_IN_THIS_SESSION";
}>;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function normalizeAddress(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return EVM_ADDRESS.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function projectSessionIdentity(input: Readonly<{
  subjectKind: "TELEGRAM" | "WALLET";
  subjectWallet: string | null;
  watchAddress: string | null;
}>): SessionIdentity {
  const identityWallet = input.subjectKind === "WALLET" ? normalizeAddress(input.subjectWallet) : null;
  return {
    subjectKind: input.subjectKind,
    identityWallet,
    legacyWatchAddress: normalizeAddress(input.watchAddress),
    walletOwnership: identityWallet ? "PROVEN_BY_SIWE" : "NOT_PROVEN_IN_THIS_SESSION",
  };
}
