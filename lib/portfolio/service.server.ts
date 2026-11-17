/**
 * The answer of `GET /api/v1/portfolio` (contract 1.98.0): the portfolio read with the deployment's own
 * readers. Reads only; never throws — a source that falls is in the answer, not an error of it.
 */

import "server-only";

import type { PortfolioResponse } from "../api/v1/contract.ts";
import { portfolioDeps } from "./readers.server.ts";
import { readPortfolio } from "./service.ts";

export async function portfolioAnswer(owner: string, refresh = false): Promise<PortfolioResponse> {
  const answer = await readPortfolio(owner, portfolioDeps(), { refresh });
  return {
    network: "solana:mainnet",
    ...answer,
    totals: { ...answer.totals },
    positions: answer.positions.map((position) => ({ ...position, tokens: position.tokens.map((token) => ({ ...token })) })),
    sources: answer.sources.map((source) => ({ ...source })),
  };
}
