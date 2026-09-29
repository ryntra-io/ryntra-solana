/**
 * A short starting list of real Solana mainnet mints.
 *
 * Not a ranking, not a recommendation and not a market. It exists because the
 * only other way into a passport is to already know a 32-to-44-character
 * base58 address, and a search box with nothing beside it is a dead end for
 * anyone who has not memorised one.
 *
 * Every address here is one of the six real mints whose raw account bytes were
 * captured live from mainnet as `lib/solana/fixtures/` in RYN-SOL-A1 and have
 * been decoded by the test suite ever since. The `note` states what the mint
 * **is** — never whether it is good; an asset list that editorialises becomes
 * a recommendation, and this product does not make those.
 */

export type FeaturedMint = Readonly<{
  mint: string;
  /** The ticker people know it by — display convenience, never an identity. */
  code: string;
  /** Which token program owns the mint. A structural fact, read on chain. */
  program: "SPL Token" | "Token-2022";
  /** What it is. Factual, never an opinion about it. */
  note: string;
}>;

const featured = (code: string, program: FeaturedMint["program"], mint: string, note: string): FeaturedMint => ({
  code,
  program,
  mint,
  note,
});

export const FEATURED_MINTS: readonly FeaturedMint[] = [
  featured(
    "PYUSD",
    "Token-2022",
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    "PayPal USD — carries PermanentDelegate, a transfer-fee config, a transfer hook and confidential transfers at once",
  ),
  featured(
    "BERN",
    "Token-2022",
    "CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo",
    "BonkEarn — a Token-2022 mint whose transfer fee reduces what the recipient receives",
  ),
  featured(
    "USDC",
    "SPL Token",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "Circle USDC — classic SPL, mint and freeze authorities present",
  ),
  featured(
    "USDT",
    "SPL Token",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "Tether USD — classic SPL, mint and freeze authorities present",
  ),
  featured(
    "BONK",
    "SPL Token",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "Bonk — classic SPL memecoin, decoded here for the plain-SPL baseline",
  ),
  featured(
    /* Labelled SOL, not wSOL. This mint IS how Solana trades its native token:
       the swap wraps and unwraps around the trade, holdings read the native
       lamport balance through it, and canon §25.4 names this pair USDC ↔ SOL.
       Printing the wrapper name hid the canary pair from the one person who
       has to sign it. The note keeps the structural truth. */
    "SOL",
    "SPL Token",
    "So11111111111111111111111111111111111111112",
    "Native SOL, traded through its SPL wrapper — the swap wraps and unwraps around the trade, and the balance shown is your native SOL. No mint authority",
  ),
];

/** The passport deep link for a mint. The page re-reads the chain on open. */
export function mintHref(mint: string): string {
  return `/app/assets?mint=${encodeURIComponent(mint)}`;
}
