/**
 * Earn's fixtures: answers shaped like the documented ones, for the cases that decide whether this
 * row is honest.
 *
 * They exist because the five situations this code has to get right are precisely the ones a live market will
 * not produce on demand — a market with nothing left to withdraw, a market that can pay only part of what was
 * asked, a rate that moves between the quote and the signature, a provider that refuses, and a key that was
 * never issued. Each one is a fixture here and a test beside it.
 *
 * The figures are invented and look it: round amounts, three markets, one wallet. Nothing here is a claim
 * about what Jupiter Lend pays — a fixture that looked like a real quote would eventually be quoted.
 */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const JL_USDC_MINT = "jLUSDC11111111111111111111111111111111111111";
export const JL_USDT_MINT = "jLUSDT11111111111111111111111111111111111111";
export const JL_SOL_MINT = "jLSOL111111111111111111111111111111111111111";

/** A wallet that holds a position in the fixtures; a base58 shape, nobody's key. */
export const FIXTURE_WALLET = "RynEarnFixtureWa11et1111111111111111111111";

/**
 * `GET /lend/v1/earn/tokens`, three markets on purpose:
 *
 * - **USDC** — healthy: a tenth of the market is liquid, so an ordinary position leaves whole.
 * - **USDT** — thin: 40 USDT liquid against 900 000 supplied, which is what makes a 100 USDT withdrawal a
 *   partial one rather than a transaction that fails on chain.
 * - **SOL** — empty: nothing to withdraw at all, the market a surface must not draw as «available».
 */
export const JUPITER_TOKENS: readonly unknown[] = [
  {
    id: 1,
    address: JL_USDC_MINT,
    name: "Jupiter Lend USDC",
    symbol: "jlUSDC",
    decimals: 6,
    asset: { address: USDC_MINT, name: "USD Coin", symbol: "USDC", decimals: 6, price: "1.0" },
    totalAssets: "12000000000000",
    totalSupply: "11800000000000",
    supplyRate: "4.12",
    totalRate: "4.12",
    liquiditySupplyData: {
      modeWithInterest: true,
      supply: "12000000000000",
      withdrawalLimit: "2000000000000",
      withdrawable: "2000000000000",
      withdrawableUntilLimit: "2000000000000",
    },
  },
  {
    id: 2,
    address: JL_USDT_MINT,
    name: "Jupiter Lend USDT",
    symbol: "jlUSDT",
    decimals: 6,
    asset: { address: USDT_MINT, name: "Tether USD", symbol: "USDT", decimals: 6, price: "1.0" },
    totalAssets: "900000000000",
    totalSupply: "890000000000",
    supplyRate: "6.40",
    totalRate: "6.40",
    liquiditySupplyData: { modeWithInterest: true, supply: "900000000000", withdrawalLimit: "40000000", withdrawable: "40000000" },
  },
  {
    id: 3,
    address: JL_SOL_MINT,
    name: "Jupiter Lend SOL",
    symbol: "jlSOL",
    decimals: 9,
    asset: { address: WSOL_MINT, name: "Wrapped SOL", symbol: "SOL", decimals: 9, price: "180.5" },
    totalAssets: "40000000000000",
    totalSupply: "39000000000000",
    supplyRate: "2.05",
    totalRate: "2.05",
    liquiditySupplyData: { modeWithInterest: true, supply: "40000000000000", withdrawalLimit: "0", withdrawable: "0" },
  },
];

/** The same three markets with USDC's rate down from 4.12 % to 3.10 %: a move of 102 bp, past the tolerance. */
export const JUPITER_TOKENS_RATE_FELL: readonly unknown[] = JUPITER_TOKENS.map((entry) => {
  const token = entry as Record<string, unknown>;
  return token.address === JL_USDC_MINT ? { ...token, supplyRate: "3.10", totalRate: "3.10" } : token;
});

/** The same three markets with USDT's liquidity gone: the case a signed withdrawal must be stopped on. */
export const JUPITER_TOKENS_LIQUIDITY_GONE: readonly unknown[] = JUPITER_TOKENS.map((entry) => {
  const token = entry as Record<string, unknown>;
  return token.address === JL_USDT_MINT
    ? { ...token, liquiditySupplyData: { ...(token.liquiditySupplyData as Record<string, unknown>), withdrawable: "0", withdrawalLimit: "0" } }
    : token;
});

/**
 * `GET /lend/v1/earn/positions?users=…` — 500 jlUSDC worth 512.4 USDC (the exchange rate having risen since
 * the deposit), and 120 jlUSDT worth 121 USDT.
 */
export const JUPITER_POSITIONS: readonly unknown[] = [
  {
    address: JL_USDC_MINT,
    ownerAddress: FIXTURE_WALLET,
    shares: "500000000",
    underlyingAssets: "512400000",
    token: { address: JL_USDC_MINT, symbol: "jlUSDC", decimals: 6, asset: { address: USDC_MINT, symbol: "USDC", decimals: 6, price: "1.0" } },
  },
  {
    address: JL_USDT_MINT,
    ownerAddress: FIXTURE_WALLET,
    shares: "120000000",
    underlyingAssets: "121000000",
    token: { address: JL_USDT_MINT, symbol: "jlUSDT", decimals: 6, asset: { address: USDT_MINT, symbol: "USDT", decimals: 6, price: "1.0" } },
  },
];

/** `GET /lend/v1/earn/earnings` — 500 USDC in and nothing out, so 12.4 USDC earned on the USDC position. */
export const JUPITER_EARNINGS: readonly unknown[] = [
  { address: JL_USDC_MINT, ownerAddress: FIXTURE_WALLET, totalDeposits: "500000000", totalWithdraws: "0" },
];

/** What the chain is standing in for in the tests: the shares this wallet really holds. */
export const FIXTURE_HELD: Readonly<Record<string, string>> = {
  [JL_USDC_MINT]: "500000000",
  [JL_USDT_MINT]: "120000000",
  [JL_SOL_MINT]: "0",
  [USDC_MINT]: "1000000000",
  [USDT_MINT]: "250000000",
};
