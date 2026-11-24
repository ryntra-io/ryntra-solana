/**
 * The answers of `/api/v1/portfolio/exit/**` (contract 1.100.0): the overview, the Review and the relay, with
 * the deployment's own builders, chain and portfolio read. The logic is `service.ts`.
 */

import "server-only";

import type { PortfolioExitOverviewResponse, PortfolioExitReviewResponse, PortfolioExitSubmitResponse } from "../../api/v1/contract.ts";
import { portfolioDeps } from "../readers.server.ts";
import { readPortfolio } from "../service.ts";
import { exitChain, exitExecute, exitForget, exitPorts, exitRoutable } from "./ports.server.ts";
import { exitOpen, exitOverview, reviewExit, submitExit, type ExitAsk, type ExitDeps, type ExitFailure } from "./service.ts";

const NETWORK = "solana:mainnet" as const;
/** The door, before a builder or the chain is touched. */
const CLOSED: ExitFailure = { ok: false, code: "CLOSED", reason: "Leaving positions in one approval is not served here." };

/** Everything the service is handed on this deployment. The chain is one per request: its first blockhash dates the package. */
function deps(): ExitDeps {
  return {
    env: process.env,
    ports: exitPorts(),
    chain: exitChain(),
    /* A Review acts on what the wallet holds now, not on a kept answer. */
    portfolio: (owner) => readPortfolio(owner, portfolioDeps(), { refresh: true }),
    execute: exitExecute,
    forget: exitForget,
  };
}

/** What one approval would do, from the portfolio's kept read and Jupiter's word on the coins a step would swap: nothing is built. */
export async function exitOverviewAnswer(ask: ExitAsk): Promise<PortfolioExitOverviewResponse> {
  const overview = await exitOverview(ask, { env: process.env, portfolio: (owner) => readPortfolio(owner, portfolioDeps()), routable: exitRoutable() });
  return { network: NETWORK, ...overview, items: overview.items.map((item) => ({ ...item })), held: overview.held.map((row) => ({ ...row })), estimate: { ...overview.estimate } };
}

export async function exitReviewAnswer(ask: ExitAsk): Promise<Readonly<{ ok: true; value: PortfolioExitReviewResponse }> | ExitFailure> {
  if (!exitOpen(process.env)) return CLOSED;
  const reviewed = await reviewExit(ask, deps());
  if (!reviewed.ok) return reviewed;
  const { summary } = reviewed.value;
  return {
    ok: true,
    value: {
      network: NETWORK,
      ...reviewed.value,
      transactions: [...reviewed.value.transactions],
      kinds: [...reviewed.value.kinds],
      refs: [...reviewed.value.refs],
      summary: {
        ...summary,
        receive: { ...summary.receive },
        done: summary.done.map((row) => ({ ...row })),
        later: summary.later.map((row) => ({ ...row })),
        skipped: summary.skipped.map((row) => ({ ...row })),
        others: summary.others.map((row) => ({ ...row })),
        held: summary.held.map((row) => ({ ...row })),
      },
    },
  };
}

export async function exitSubmitAnswer(body: unknown): Promise<Readonly<{ ok: true; value: PortfolioExitSubmitResponse }> | ExitFailure> {
  if (!exitOpen(process.env)) return CLOSED;
  const relayed = await submitExit(body, deps());
  if (!relayed.ok) return relayed;
  return { ok: true, value: { results: relayed.value.results.map((result) => ({ ...result })), settled: relayed.value.settled } };
}
