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

import { label } from "../assistant/data/dexscreener.ts";
import { readDexPairs, readRugCheck } from "../assistant/data/sources.server.ts";
import { readDigest } from "../assistant/news/store.ts";
import { readMarketEvidence } from "../evidence/service.server.ts";
import { readStockLiquidity } from "../liquidity/service.server.ts";
import { readSpotCandles } from "../spot/candles.server.ts";
import type { PulseRow } from "../spot/pulse.ts";
import { readPulse } from "../spot/pulse.server.ts";
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
import { type AgentModel } from "./model.ts";
import { createProviderAgentModel } from "./providers.ts";
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
    ...createMarketDataReaders(),
    /* AI-09: the digest the collector built — one read of the store; a question never starts a collection. */
    async news(mint) {
      return readDigest(store, mint, now());
    },
  };
}

/** A read that did not finish in time is a read with a reason; the answer does not wait on a slow source. */
async function within<T>(ms: number, work: Promise<T>, late: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AI-03: the market's public sources behind the reader seam — DexScreener and
 * RugCheck (`lib/assistant/data`), and the product's own reads the pages use:
 * the chart's GeckoTerminal candles, Pulse's movers, the Meteora pools of the
 * liquidity page, Market Health of a Ryntra launch. Each is projected to the
 * few figures a tool says; none needs a key, none reads anything of anyone's
 * own, and each is bounded in time.
 */
export function createMarketDataReaders(): Pick<AgentReaders, "dexPairs" | "tokenReport" | "candles" | "movers" | "pools" | "launchHealth"> {
  return {
    async dexPairs(mint) {
      const read = await readDexPairs(mint);
      return read.ok ? { ok: true, pairs: read.value, observedAt: read.observedAt, stale: read.stale } : read;
    },
    async tokenReport(mint) {
      const read = await readRugCheck(mint);
      return read.ok ? { ok: true, report: read.value, observedAt: read.observedAt, stale: read.stale } : read;
    },
    async candles(mint, timeframe) {
      const read = await within(7_000, readSpotCandles(mint, timeframe), { ok: false as const, code: "UNREACHABLE" as const, reason: "The chart source did not answer in time." });
      if (!read.ok) return { ok: false, code: read.code, reason: read.reason };
      return {
        ok: true,
        timeframe,
        candles: read.candles.map((bar) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close })),
        pool: { name: label(read.pool.name, "pool", 40), dex: label(read.pool.dex, "DEX"), reserveUsd: read.pool.reserveUsd },
        observedAt: read.observedAt,
        stale: read.stale,
      };
    },
    async movers(window) {
      const read = await within(10_000, readPulse("movers", window), { ok: false as const, code: "UNREACHABLE" as const, reason: "Pulse did not answer in time." });
      if (!read.ok) return { ok: false, reason: read.reason };
      const row = (entry: PulseRow) => ({ mint: entry.mint, symbol: label(entry.symbol), changePct: entry.windows[window].changePct, volumeUsd: entry.windows[window].volumeUsd, liquidityUsd: entry.liquidityUsd, verified: entry.verified });
      return { ok: true, window, up: read.rows.slice(0, 8).map(row), down: (read.down ?? []).slice(0, 8).map(row), observedAt: read.observedAt, stale: read.stale };
    },
    async pools(mint) {
      const read = await within(8_000, readStockLiquidity(mint), null);
      if (!read) return { ok: false, reason: "The pools did not answer in time." };
      if (read.state === "unavailable") return { ok: false, reason: "Meteora's pools could not be read." };
      return {
        ok: true,
        state: read.state,
        pools: read.pools
          .filter((pool) => !pool.blacklisted)
          .slice(0, 6)
          .map((pool) => ({ kind: pool.kind, name: label(pool.name, "pool", 40), address: pool.address, tvlUsd: pool.tvlUsd, volume24hUsd: pool.volume24hUsd, fees24hUsd: pool.fees24hUsd })),
        meaningful: read.meaningfulCount,
        totals: read.totals,
        observedAt: read.fetchedAt,
      };
    },
    async launchHealth(mint) {
      /* Loaded on the first question about a token: the launch reads are heavy and most questions never need them. */
      const [{ launchHealthDeps }, { marketForAnswer, marketHealth }] = await Promise.all([import("../launch/runtime.server.ts"), import("../launch/health.server.ts")]);
      const deps = launchHealthDeps();
      if (!deps) return { ok: true, health: null };
      const answered = await within(5_000, marketForAnswer(deps, mint).then(({ read, behind }) => {
              /* An older good read answers now and is read again behind it, as the health route does. */
              if (behind) void behind().catch(() => null);
              return read ? marketHealth(read, deps.network, null) : null;
            }).catch(() => undefined), undefined);
      if (answered === undefined) return { ok: false, reason: "The launch market could not be read now." };
      if (answered === null) return { ok: true, health: null };
      return {
        ok: true,
        health: {
          state: answered.state.code,
          venue: answered.venue,
          holders: answered.holders.count,
          holdersAtLeast: answered.holders.atLeast,
          top10Pct: answered.concentration.top10Bps === null ? null : answered.concentration.top10Bps / 100,
          top10AtLeast: answered.concentration.atLeast,
          traded24h: answered.survival.traded24h,
          daysSinceDex: answered.survival.daysSinceDex,
          priceVsDexPct: answered.survival.priceVsDexBps === null ? null : answered.survival.priceVsDexBps / 100,
          creatorSold: answered.creator.sold,
          observedAt: answered.observedAt,
        },
      };
    },
  };
}

export function createAgentModel(env: Readonly<Record<string, string | undefined>> = process.env): AgentModel | null {
  const config = resolveAgentBudgetConfig(env);
  if (!config.modelEnabled) return null;
  // CITY-205: OpenAI, or Anthropic or OpenRouter when the deployment names it, holds its key and names its models.
  return createProviderAgentModel({ env });
}

export function createAgentDeps(input: Readonly<{ store: GuardStore; holdings: HoldingsReader; env?: Readonly<Record<string, string | undefined>>; budget?: AgentBudgetConfig; model?: AgentModel | null }>): AgentDeps {
  const env = input.env ?? process.env;
  const budget = input.budget ?? resolveAgentBudgetConfig(env);
  const model = input.model !== undefined ? input.model : createAgentModel(env);
  return { store: input.store, readers: createAgentReaders(input.store, input.holdings), model, budget };
}
