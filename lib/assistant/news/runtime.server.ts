/**
 * The news collector on the server (AI-09) — what the two crons run.
 *
 * Every ten minutes `runNewsCollection` reads the feeds and labels the new
 * items with the everyday model, when the deployment switched the model on
 * (`RYNTRA_AGENT_MODEL_ENABLED=1` beside the key); every call leaves a
 * priced receipt paid by `system_news` and a `[assistant.cost]` line. Every
 * hour `runNewsRefresh` refreshes the followed tokens from the watchlists,
 * rebuilds every digest and removes items older than three days.
 *
 * Nothing here signs, sends or spends anyone's money; the only writes are
 * the platform's own news cache and the receipts.
 */

import type { GuardStore } from "../../guard/store.ts";
import { resolveAgentBudgetConfig, writeReceipt } from "../../agent/budget.ts";
import { createOpenAiAgentModel, promptVersionOf } from "../../agent/model.ts";
import { jupiterBackgroundAllowed } from "../../solana/jupiter-budget.ts";
import { readSpotMarketsByMint } from "../../spot/markets.server.ts";
import { SpotWatchlistSchema } from "../../spot/watchlist.ts";
import { costMicroUsd } from "../models.ts";
import { collectNews, refreshNews, type NewsLabeller } from "./collect.ts";
import type { RunReport } from "./store.ts";

const SYSTEM_PAYER = "system_news";

/** The labeller over the configured model, or null when the deployment has none switched on. */
export function newsLabeller(store: GuardStore, env: Readonly<Record<string, string | undefined>> = process.env, runId: string): NewsLabeller | null {
  if (!resolveAgentBudgetConfig(env).modelEnabled) return null;
  const model = createOpenAiAgentModel({ env });
  if (!model?.tagNews) return null;
  const tag = model.tagNews.bind(model);
  return async (batch) => {
    const answer = await tag(batch);
    const outcome = answer.ok ? "ok" : answer.outcome;
    await writeReceipt(store, { owner: SYSTEM_PAYER, sessionId: "news:collect", turnId: runId, model: answer.model, promptVersion: promptVersionOf("news_tag"), task: "news_tag", tokens: answer.usage, latencyMs: answer.latencyMs, outcome, at: new Date().toISOString() }).catch(() => null);
    const cost = answer.usage.total === 0 && outcome !== "ok" && outcome !== "unavailable" ? null : costMicroUsd(answer.model, answer.usage);
    return { ok: answer.ok, tags: answer.ok ? answer.tags : [], costMicroUsd: answer.usage.total === 0 && outcome === "unavailable" ? 0 : cost };
  };
}

/** One run; null when another run already holds this slot (a cron delivered twice). */
export async function runNewsCollection(store: GuardStore, nowMs: number, env: Readonly<Record<string, string | undefined>> = process.env): Promise<RunReport | null> {
  const runId = `nwr_${nowMs.toString(16)}${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
  return collectNews({ store, nowMs, label: newsLabeller(store, env, runId), runId, lock: true });
}

/** Every watchlist's mints — one entry per wallet that follows the mint; read only. */
async function followedMints(store: GuardStore): Promise<string[]> {
  const rows = await store.collection<unknown>("spotWatchlists").valuesWithPrefix("mainnet:");
  return rows.flatMap((row) => {
    const parsed = SpotWatchlistSchema.safeParse(row);
    return parsed.success ? [...new Set(parsed.data.mints)] : [];
  });
}

export async function runNewsRefresh(store: GuardStore, nowMs: number): Promise<Readonly<{ digests: number; followed: number | null; pruned: number }>> {
  const mints = await followedMints(store).catch(() => [] as string[]);
  return refreshNews({
    store,
    nowMs,
    followedMints: mints,
    /* One batch read of the catalogue, and none at all when the shared Jupiter budget is low — people's reads come first. */
    lookup: async (top) => {
      if (!jupiterBackgroundAllowed(Date.now())) return null;
      const read = await readSpotMarketsByMint(top);
      if (!read.ok) return null;
      return new Map([...read.byMint].map(([mint, market]) => [mint, { symbol: market.symbol, name: market.name }]));
    },
  });
}
