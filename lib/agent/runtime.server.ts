/**
 * The agent's runtime — the real readers behind the tools, and the model
 * behind the composer. Server only.
 *
 * Every reader is the product's own service: the Spot catalogue and its
 * search, the stock universe, the evidence layer with its budgets and
 * rights, the plan store through the plan service, the wallet's History
 * ledger, the watchlist, the monitoring surface. The holdings read is the
 * one the routes must hand in (`holdings`): it lives in the holdings route
 * itself, and the agent's route invokes that handler in-process so the same
 * discipline (the two token programs, the second attempt, the catalogue
 * overlay) answers the agent that answers the Portfolio page.
 *
 * The model is created only when the explicit switch is on beside the key
 * (`RYNTRA_AGENT_MODEL_ENABLED=1` and `OPENAI_API_KEY`); otherwise it is
 * null and every answer is deterministic — nothing is spent.
 */

import { readMarketEvidence } from "../evidence/service.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { readMonitoringSurface } from "../monitoring/service.server.ts";
import { listInbox, monitorNotes } from "../monitoring/store.ts";
import { getPlan, getPlanResults, listPlanMemory, listPlans, readPlanAsset } from "../plans/service.ts";
import { readTradingPlan } from "../plans/store.ts";
import { listSolanaWalletActions } from "../solana/action-ledger.ts";
import { readSpotMarket, searchSpotMarkets } from "../spot/markets.server.ts";
import { readSpotWatchlist } from "../spot/watchlist.ts";
import { findStockRow } from "../stocks/universe.server.ts";
import { resolveAgentBudgetConfig, type AgentBudgetConfig } from "./budget.ts";
import { createOpenAiAgentModel, type AgentModel } from "./model.ts";
import type { AgentDeps } from "./service.ts";
import type { AgentReaders, HoldingsRead } from "./tools/readers.ts";

export type HoldingsReader = (owner: string) => Promise<HoldingsRead>;

export function createAgentReaders(store: GuardStore, holdings: HoldingsReader, deps: Readonly<{ now?: () => number }> = {}): AgentReaders {
  const now = deps.now ?? Date.now;
  return {
    async spotMarket(mint) {
      const read = await readSpotMarket(mint);
      return read.ok ? read : { ok: false, reason: read.reason };
    },
    async spotSearch(query, limit) {
      const read = await searchSpotMarkets(query, limit);
      return read.ok ? { ok: true, rows: read.rows, observedAt: read.observedAt, stale: read.stale } : { ok: false, reason: read.reason };
    },
    async stockRow(tickerOrMint) {
      return findStockRow(tickerOrMint);
    },
    async evidence(input) {
      return readMarketEvidence({ mint: input.mint, window: input.window, provider: input.provider, nowMs: now() });
    },
    holdings,
    async plans(owner) {
      return listPlans(store, owner);
    },
    async plan(owner, planId) {
      const read = await getPlan(store, owner, planId);
      if (!read.ok) return { ok: false, code: read.code, message: read.message };
      const record = await readTradingPlan(store, owner, planId);
      return { ok: true, plan: read.plan, reviews: record?.reviews ?? [], sync: read.sync };
    },
    async planResults(owner, planId) {
      const read = await getPlanResults(store, owner, planId);
      return read.ok ? { ok: true, results: read.results, sync: read.sync } : { ok: false, code: read.code, message: read.message };
    },
    async planMemory(owner) {
      /* The monitoring notes are part of memory; a surface that did not answer leaves the plans' own facts, which is smaller and never wrong. */
      const surface = await readMonitoringSurface(store, owner, now(), "en").catch(() => null);
      return listPlanMemory(store, owner, monitorNotes(surface?.recent ?? []));
    },
    async planAsset(mint) {
      const read = await readPlanAsset(mint);
      return read.ok ? { ok: true, read: read.read } : { ok: false, code: read.code, message: read.message };
    },
    async activity(owner) {
      try {
        return (await listSolanaWalletActions(store, { network: "mainnet", wallet: owner })).actions;
      } catch {
        return [];
      }
    },
    async watchlist(owner) {
      try {
        return await readSpotWatchlist(store, owner);
      } catch {
        return [];
      }
    },
    async monitoring(owner, locale) {
      return readMonitoringSurface(store, owner, now(), locale);
    },
    async inboxNote(owner, inboxId) {
      const rows = await listInbox(store, owner);
      return rows.find((row) => row.id === inboxId) ?? null;
    },
  };
}

export function createAgentModel(env: Readonly<Record<string, string | undefined>> = process.env): AgentModel | null {
  const config = resolveAgentBudgetConfig(env);
  if (!config.modelEnabled) return null;
  return createOpenAiAgentModel({ env });
}

export function createAgentDeps(input: Readonly<{ store: GuardStore; holdings: HoldingsReader; env?: Readonly<Record<string, string | undefined>>; budget?: AgentBudgetConfig; model?: AgentModel | null }>): AgentDeps {
  const env = input.env ?? process.env;
  const budget = input.budget ?? resolveAgentBudgetConfig(env);
  const model = input.model !== undefined ? input.model : createAgentModel(env);
  return { store: input.store, readers: createAgentReaders(input.store, input.holdings), model, budget };
}
