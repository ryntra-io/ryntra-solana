/**
 * What the pre-sign check knows by name: the programs a transaction may call, and the few mints whose issuer holds a
 * compliance power by design (a stablecoin's freeze authority is its issuer's, written in its terms — the check names
 * it as information, not as a warning on every dollar sent).
 *
 * Every id here is already used elsewhere in this repository or is a core Solana program; nothing is guessed. A
 * program missing from this list is not suspicious by itself — it is named, as unknown, and changes no verdict.
 */

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
export const UPGRADEABLE_LOADER_PROGRAM = "BPFLoaderUpgradeab1e11111111111111111111111";
export const LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

/** Programs by name. Labels are the programs' own public names. */
export const KNOWN_PROGRAMS: Readonly<Record<string, string>> = {
  [SYSTEM_PROGRAM]: "System",
  [TOKEN_PROGRAM]: "Token",
  [TOKEN_2022_PROGRAM]: "Token-2022",
  [ASSOCIATED_TOKEN_PROGRAM]: "Associated Token",
  [COMPUTE_BUDGET_PROGRAM]: "Compute Budget",
  [STAKE_PROGRAM]: "Stake",
  [UPGRADEABLE_LOADER_PROGRAM]: "Upgradeable Loader",
  [LOOKUP_TABLE_PROGRAM]: "Address Lookup Table",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: "Memo v1",
  L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95: "Lighthouse",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
  j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X: "Jupiter Trigger",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora DBC",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: "Squads",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump",
};

export type KnownMint = Readonly<{
  symbol: string;
  decimals: number;
  /** The issuer whose freeze authority, permanent delegate or pause is part of the token's published terms. */
  issuer: string | null;
}>;

/** Mints the check names by symbol. Decimals are the chain's; a read always wins over this table. */
export const KNOWN_MINTS: Readonly<Record<string, KnownMint>> = {
  [WRAPPED_SOL_MINT]: { symbol: "SOL", decimals: 9, issuer: null },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6, issuer: "Circle" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6, issuer: "Tether" },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", decimals: 6, issuer: "Paxos" },
};

/** A symbol an intent may name instead of a mint. SOL is native: `null`. */
export function mintOfSymbol(symbol: string): string | null | undefined {
  const upper = symbol.trim().toUpperCase();
  if (upper === "SOL" || upper === "WSOL") return null;
  for (const [mint, known] of Object.entries(KNOWN_MINTS)) if (known.symbol === upper) return mint;
  return undefined;
}

export function programLabel(id: string): string | null {
  return KNOWN_PROGRAMS[id] ?? null;
}
