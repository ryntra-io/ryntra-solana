/**
 * The fields a mint's profile is compared by (SOL-L12, `./mint-profile.ts`) — the names a page, a note and the API use
 * for a change of what the issuer can do. Pure and client-safe.
 */
export const MINT_PROFILE_FIELDS = [
  "program",
  "decimals",
  "mintAuthority",
  "freezeAuthority",
  "extensions",
  "transferFee",
  "transferFeeAuthority",
  "permanentDelegate",
  "defaultAccountState",
  "transferHook",
  "closeAuthority",
  "pausable",
] as const;
export type MintProfileField = (typeof MINT_PROFILE_FIELDS)[number];
