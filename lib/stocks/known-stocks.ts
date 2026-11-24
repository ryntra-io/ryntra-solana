/**
 * The tokenized stocks Ryntra knows by their mint — the book the look-alike rule reads
 * (`lib/world/text-safety/lookalike.ts`): a coin on another mint that takes one of these tickers, or names one
 * of these companies, is not that stock.
 *
 * A row is a mint two sources agree on: the venue verified it and tagged it with its issuer (Jupiter Tokens v2, read
 * 2026-11-17 — the fixture `lib/market-depth/fixtures/jupiter-2026-11-17.json`, and the market snapshot of 2026-10-26),
 * and, for ANT, the issuer's own public list of assets (Backpack, `api.backpack.exchange/api/v1/assets`, read 2026-11-19:
 * `ANT.US`, «Anthropic», this contract address). On the server the stock universe adds every representation it holds
 * (`knownStocksOfRows` in `shelf.ts`); this static book is what a browser and a cold server know without it.
 *
 * `kind`: `company` — a listed company's share; `private` — a private company's token before its IPO (PreStocks); `fund`
 * — an index or other fund, whose name («Gold», «Nasdaq») is a common word and is never matched as a company's.
 *
 * Pure data: no network, no imports.
 */

export type KnownStockKind = "company" | "private" | "fund";

export type KnownStock = Readonly<{
  mint: string;
  /** The token's own ticker, as the issuer names it. */
  symbol: string;
  /** The company as a person names it; a fund's index. */
  company: string;
  issuer: "xstocks" | "backpack" | "ondo" | "prestocks";
  kind: KnownStockKind;
}>;

/** When the book was last read, and from where. */
export const KNOWN_STOCKS_READ = { at: "2026-11-19", sources: ["jupiter-tokens-v2 (2026-11-17)", "backpack-public-api (2026-11-19, ANT)"] } as const;

export const KNOWN_STOCKS: readonly KnownStock[] = Object.freeze([
  /* Backpack Securities — the exchange's own ticker. ANT: confirmed by Backpack's public list of assets on 2026-11-19. */
  { mint: "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe", symbol: "ANT", company: "Anthropic", issuer: "backpack", kind: "company" },
  { mint: "AMD8XwJXgQ9WV45Wyj9yFLejxzf2J6VM1PJY8bJEjeES", symbol: "AMD", company: "Advanced Micro Devices", issuer: "backpack", kind: "company" },
  { mint: "DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF", symbol: "DJT", company: "Trump Media & Technology Group", issuer: "backpack", kind: "company" },
  { mint: "GPRR2u6NS5yBQHWGauoJ9HXgjrTH8dDsrBfTV5zAYvDH", symbol: "GPRO", company: "GoPro", issuer: "backpack", kind: "company" },
  { mint: "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv", symbol: "NVDA", company: "Nvidia", issuer: "backpack", kind: "company" },
  { mint: "oPNWKYTYJyEs2RbpjUXfCTxrNtiTjTcz3ipvUvBBAH2", symbol: "OPNW", company: "OpenWorld", issuer: "backpack", kind: "company" },
  { mint: "PUSAG1stksTcAoK9MjinEHUwAYRJsbovywYCk37m6hy", symbol: "PUSA", company: "Powerus", issuer: "backpack", kind: "company" },
  { mint: "SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3", symbol: "SKHY", company: "SK Hynix", issuer: "backpack", kind: "company" },
  { mint: "SNAPcESrvnH8yUdgeMF6xm1hym9b6hW6s8YeqeHdZFz", symbol: "SNAP", company: "Snap", issuer: "backpack", kind: "company" },
  { mint: "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH", symbol: "SNDK", company: "Sandisk", issuer: "backpack", kind: "company" },
  { mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", symbol: "SPCX", company: "SpaceX", issuer: "backpack", kind: "company" },
  { mint: "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S", symbol: "TSLA", company: "Tesla", issuer: "backpack", kind: "company" },
  { mint: "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo", symbol: "TTWO", company: "Take-Two Interactive", issuer: "backpack", kind: "company" },
  { mint: "SQQQAa3gUxgnqcEsdjPA4RQNQBgB97TnG2hJhk2WaGE", symbol: "SQQQ", company: "ProShares UltraPro Short QQQ", issuer: "backpack", kind: "fund" },
  { mint: "UVXY4ojmAMTaPwUmrRmcuxWHjMHCbz3BxX2RBMzjYKx", symbol: "UVXY", company: "ProShares Ultra VIX Short-Term Futures", issuer: "backpack", kind: "fund" },
  /* xStocks · Backed — the ticker with «x». */
  { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", symbol: "AAPLx", company: "Apple", issuer: "xstocks", kind: "company" },
  { mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", symbol: "AMZNx", company: "Amazon", issuer: "xstocks", kind: "company" },
  { mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo", symbol: "AVGOx", company: "Broadcom", issuer: "xstocks", kind: "company" },
  { mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", symbol: "COINx", company: "Coinbase", issuer: "xstocks", kind: "company" },
  { mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", symbol: "CRCLx", company: "Circle", issuer: "xstocks", kind: "company" },
  { mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", symbol: "GMEx", company: "GameStop", issuer: "xstocks", kind: "company" },
  { mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", symbol: "GOOGLx", company: "Alphabet", issuer: "xstocks", kind: "company" },
  { mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", symbol: "HOODx", company: "Robinhood", issuer: "xstocks", kind: "company" },
  { mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2", symbol: "MCDx", company: "McDonald's", issuer: "xstocks", kind: "company" },
  { mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", symbol: "METAx", company: "Meta", issuer: "xstocks", kind: "company" },
  { mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", symbol: "MSFTx", company: "Microsoft", issuer: "xstocks", kind: "company" },
  { mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", symbol: "MSTRx", company: "MicroStrategy", issuer: "xstocks", kind: "company" },
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", symbol: "NVDAx", company: "NVIDIA", issuer: "xstocks", kind: "company" },
  { mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", symbol: "PLTRx", company: "Palantir", issuer: "xstocks", kind: "company" },
  { mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", symbol: "SPCXx", company: "SpaceX", issuer: "xstocks", kind: "company" },
  { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", symbol: "TSLAx", company: "Tesla", issuer: "xstocks", kind: "company" },
  { mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH", symbol: "STRCx", company: "Strategy PP Variable", issuer: "xstocks", kind: "fund" },
  { mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", symbol: "GLDx", company: "Gold", issuer: "xstocks", kind: "fund" },
  { mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", symbol: "QQQx", company: "Nasdaq 100", issuer: "xstocks", kind: "fund" },
  { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", symbol: "SPYx", company: "S&P 500", issuer: "xstocks", kind: "fund" },
  /* Ondo Global Markets — the ticker with «on». */
  { mint: "wzAyQTorWyoVXuJKj2x8EqKEGJpS13z6EWE9z5Aondo", symbol: "SPCXon", company: "SpaceX", issuer: "ondo", kind: "company" },
  /* PreStocks — a private company's token before its IPO, named by the company. */
  { mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", symbol: "ANDURIL", company: "Anduril", issuer: "prestocks", kind: "private" },
  { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", symbol: "ANTHROPIC", company: "Anthropic", issuer: "prestocks", kind: "private" },
  { mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", symbol: "FIGUREAI", company: "Figure AI", issuer: "prestocks", kind: "private" },
  { mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", symbol: "KALSHI", company: "Kalshi", issuer: "prestocks", kind: "private" },
  { mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", symbol: "NEURALINK", company: "Neuralink", issuer: "prestocks", kind: "private" },
  { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", symbol: "OPENAI", company: "OpenAI", issuer: "prestocks", kind: "private" },
  { mint: "Pre9atBqkocK1QngFy7Q7zvyQictEFpXdLi6bZ2qnYy", symbol: "OURA", company: "Oura", issuer: "prestocks", kind: "private" },
  { mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", symbol: "POLYMARKET", company: "Polymarket", issuer: "prestocks", kind: "private" },
  { mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", symbol: "SPACEX", company: "SpaceX", issuer: "prestocks", kind: "private" },
]);
