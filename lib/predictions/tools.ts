/**
 * The prediction-market tools for Ryn (`RYN-PREDICTIONS-001` item 16, canon
 * v4.3 §6.5, §20.11): provider-neutral, permissioned, read and prepare only.
 *
 * Every tool takes a `ToolContext` — who is asking (the proven wallet, or
 * nobody) — and answers the same view models the pages read. The public
 * tools need no wallet; the paper account needs one; there is no execute
 * tool and none will be added here: a paper order is placed only through
 * the Review and the person's own action (`paper.ts`), never by an agent.
 *
 * The registry (`PREDICTION_TOOLS`) is what the one Ryntra Agent will
 * register later (`RYN-AGENT-TEXT-001`); the names are the Owner's.
 *
 * Server only.
 */

import type { GuardStore } from "../guard/store.ts";
import { failure } from "./failure.ts";
import { readPaperAccount, type PaperAccountView } from "./paper.ts";
import type { DiscoverPage, PredictionProvider, Result, RouteRequest } from "./provider.ts";
import { withProviderSession } from "./session.ts";
import type {
  PredictionBook,
  PredictionChart,
  PredictionEvent,
  PredictionEventSummary,
  PredictionMarket,
  PredictionNews,
  PredictionRelatedMarket,
  PredictionRipple,
  PredictionRoute,
  PredictionSignals,
} from "./model.ts";

export type ToolContext = Readonly<{
  /** The proven Ryntra wallet, or null for a public read. */
  wallet: string | null;
  provider: PredictionProvider;
  store: GuardStore;
}>;

export type ToolPermission = "public" | "wallet";

export type PredictionTool<I, O> = Readonly<{
  name: string;
  permission: ToolPermission;
  /** What the tool does, for the agent's tool description; never a recommendation. */
  description: string;
  run: (ctx: ToolContext, input: I) => Promise<Result<O>>;
}>;

function needsWallet(ctx: ToolContext): string | null {
  return ctx.wallet;
}

export const searchPredictionMarkets: PredictionTool<Readonly<{ q?: string; category?: string | null; sort?: "volume24h" | "volume" | "newest" | "ending"; limit?: number }>, DiscoverPage | readonly PredictionEventSummary[]> = {
  name: "searchPredictionMarkets",
  permission: "public",
  description: "Search prediction events by text, or list open events by category and sort. Prices are venue midpoints at read time.",
  run: (ctx, input) => (input.q && input.q.trim().length > 0 ? ctx.provider.search(input.q, input.limit ?? 16) : ctx.provider.discover({ category: input.category ?? null, sort: input.sort ?? "volume24h", limit: input.limit ?? 24 })),
};

export const getPredictionEvent: PredictionTool<Readonly<{ eventId: string }>, PredictionEvent> = {
  name: "getPredictionEvent",
  permission: "public",
  description: "One event with its markets across venues, outcomes, live midpoints, resolution rules and settlement differences.",
  run: (ctx, input) => ctx.provider.event(input.eventId),
};

export const getPredictionMarket: PredictionTool<Readonly<{ eventId: string; venueMarketId: string }>, PredictionMarket> = {
  name: "getPredictionMarket",
  permission: "public",
  description: "One market of an event: its outcomes, rules, matched venues and last prices.",
  run: async (ctx, input) => {
    const event = await ctx.provider.event(input.eventId);
    if (!event.ok) return event;
    const market = event.value.markets.find((m) => m.id === input.venueMarketId);
    return market ? { ok: true, value: market } : failure("NOT_FOUND", "No such market in this event.");
  },
};

export const getPredictionChart: PredictionTool<Readonly<{ outcomeId: string; resolution?: "1m" | "5m" | "1h" | "1d"; countBack?: number }>, PredictionChart> = {
  name: "getPredictionChart",
  permission: "public",
  description: "The price history of one outcome as bars (open, high, low, close; volume where the venue reports it).",
  run: (ctx, input) => ctx.provider.chart(input.outcomeId, input.resolution ?? "1h", input.countBack ?? 96),
};

export const getPredictionOrderbook: PredictionTool<Readonly<{ venueMarketId: string; depth?: number }>, PredictionBook> = {
  name: "getPredictionOrderbook",
  permission: "public",
  description: "The live order books of a market on every venue of its cluster, and the best levels across them.",
  run: (ctx, input) => ctx.provider.book(input.venueMarketId, input.depth ?? 10),
};

export const getPredictionNews: PredictionTool<Readonly<{ venueMarketId: string; limit?: number }>, PredictionNews> = {
  name: "getPredictionNews",
  permission: "public",
  description: "News the provider found for a market, with its search window. Sources are the articles' own.",
  run: (ctx, input) => ctx.provider.news(input.venueMarketId, input.limit ?? 5),
};

export const getRelatedPredictionMarkets: PredictionTool<Readonly<{ text: string; limit?: number }>, readonly PredictionRelatedMarket[]> = {
  name: "getRelatedPredictionMarkets",
  permission: "public",
  description: "Markets whose generated signals relate to a text. A relation is the provider's model's, not a fact.",
  run: (ctx, input) => ctx.provider.related(input.text, input.limit ?? 10),
};

export const getPredictionSignals: PredictionTool<Readonly<{ venueMarketId: string }>, PredictionSignals | null> = {
  name: "getPredictionSignals",
  permission: "public",
  description: "The provider's generated Yes/No signals for a market, with the model and prompt version named. Advisory, never a recommendation.",
  run: (ctx, input) => ctx.provider.signals(input.venueMarketId),
};

export const getPredictionRipple: PredictionTool<Readonly<{ venueMarketId: string; mode?: "expand" | "hedge"; limit?: number }>, PredictionRipple> = {
  name: "getPredictionRipple",
  permission: "public",
  description: "Events the provider's model names as expansions or hedges of a market resolving. Advisory.",
  run: (ctx, input) => ctx.provider.ripple(input.venueMarketId, input.mode ?? "expand", input.limit ?? 10),
};

export const preparePredictionRoute: PredictionTool<RouteRequest, PredictionRoute> = {
  name: "preparePredictionRoute",
  permission: "wallet",
  description: "Price a paper route for the wallet's own paper account — a quote, never an order. Placing it is the person's act in the Review.",
  run: async (ctx, input) => {
    const wallet = needsWallet(ctx);
    if (!wallet) return failure("UNAUTHORIZED", "A route is priced for a proven wallet only.");
    return withProviderSession(ctx.store, ctx.provider, wallet, (session) => ctx.provider.route(session, input));
  },
};

export const getPaperPredictionPortfolio: PredictionTool<Readonly<Record<string, never>>, PaperAccountView> = {
  name: "getPaperPredictionPortfolio",
  permission: "wallet",
  description: "The wallet's paper account: balance, positions and orders as the provider states them, and Ryntra's own order records.",
  run: async (ctx) => {
    const wallet = needsWallet(ctx);
    if (!wallet) return failure("UNAUTHORIZED", "The paper account belongs to a proven wallet.");
    return { ok: true, value: await readPaperAccount(ctx.store, ctx.provider, wallet) };
  },
};

/** Every tool, by name — the agent registers from here. No execute tool exists. */
export const PREDICTION_TOOLS = [
  searchPredictionMarkets,
  getPredictionEvent,
  getPredictionMarket,
  getPredictionChart,
  getPredictionOrderbook,
  getPredictionNews,
  getRelatedPredictionMarkets,
  getPredictionSignals,
  getPredictionRipple,
  preparePredictionRoute,
  getPaperPredictionPortfolio,
] as const;

export const PREDICTION_TOOL_NAMES = PREDICTION_TOOLS.map((t) => t.name);

/** Run a tool by name with the permission decided here, never by the caller. */
export async function runPredictionTool(ctx: ToolContext, name: string, input: unknown): Promise<Result<unknown>> {
  const tool = PREDICTION_TOOLS.find((t) => t.name === name);
  if (!tool) return failure("NOT_FOUND", `No prediction tool named ${name}.`);
  if (tool.permission === "wallet" && !ctx.wallet) return failure("UNAUTHORIZED", `${name} acts for a proven wallet only.`);
  return (tool as PredictionTool<unknown, unknown>).run(ctx, input ?? {});
}
