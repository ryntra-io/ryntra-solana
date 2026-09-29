/**
 * The issuer's product pages the IPO and conversion watch reads every day
 * against the registry of events (`lifecycle-events.ts`,
 * `lib/monitoring/issuer-events.ts`) — PreStocks publishes an event on the
 * company's product page only, never in its API.
 *
 * The eight companies PreStocks lists, read on 2026-09-25 (06:00 UTC): the
 * SpaceX page carries the notice; the seven others carry none. The xAI page is
 * read too: its token has left the catalogue, and its notice stays.
 */

export type IssuerPage = Readonly<{ symbol: string; mint: string; url: string }>;

export const PRESTOCKS_PAGES: readonly IssuerPage[] = [
  { symbol: "ANDURIL", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", url: "https://www.prestocks.com/anduril" },
  { symbol: "ANTHROPIC", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", url: "https://www.prestocks.com/anthropic" },
  { symbol: "FIGUREAI", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", url: "https://www.prestocks.com/figureai" },
  { symbol: "KALSHI", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", url: "https://www.prestocks.com/kalshi" },
  { symbol: "NEURALINK", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", url: "https://www.prestocks.com/neuralink" },
  { symbol: "OPENAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", url: "https://www.prestocks.com/openai" },
  { symbol: "POLYMARKET", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", url: "https://www.prestocks.com/polymarket" },
  { symbol: "SPACEX", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", url: "https://www.prestocks.com/spacex" },
  { symbol: "XAI", mint: "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx", url: "https://www.prestocks.com/xai" },
];
