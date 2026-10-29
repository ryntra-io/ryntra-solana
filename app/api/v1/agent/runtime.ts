import { POST as readHoldingsRoute } from "@/app/api/solana/holdings/route";
import { resolveAgentBudgetConfig } from "@/lib/agent/budget";
import { holdingsReadFromAnswer } from "@/lib/agent/holdings-from-route";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER as FIXTURE_OWNER, type FixtureWorld } from "@/lib/agent/fixtures";
import { createFixtureAgentModel } from "@/lib/agent/model";
import { createAgentDeps, type HoldingsReader } from "@/lib/agent/runtime.server";
import { readDigest } from "@/lib/assistant/news/store";
import { resolveHolder, type ResolvedHolder } from "@/lib/assistant/credits/holder";
import { creditsDeps } from "@/lib/assistant/credits/runtime.server";
import { accountByWallet } from "@/lib/account/rpc";
import { SpotWatchlistSchema, spotWatchlistKey } from "@/lib/spot/watchlist";
import { creditsContextFor, type AgentDeps } from "@/lib/agent/service";
import type { CreditsContext } from "@/lib/agent/budget";
import { getGuardRuntime } from "@/lib/guard/runtime";

/**
 * The agent's dependencies for one request.
 *
 * The holdings reader invokes the holdings route in-process with the
 * caller's own forwarding headers, so the read is rate-limited and disciplined
 * exactly as the Portfolio page's is — one implementation, two callers. The
 * stand runs the fixture world when `RYNTRA_AGENT_FIXTURES=1`: every wallet
 * that signs in gets its own fixture world in the stand's durable store (its
 * plans written by the real plan engine), so isolation is tested for real
 * and nothing reaches the network; the fixture model composes, and nothing
 * is spent.
 */

export const FIXTURES_ENV = "RYNTRA_AGENT_FIXTURES";
/**
 * `route` on the stand: the fixture world, but the holdings read through the
 * real holdings route over the public RPC — the one reader whose answer the
 * fixtures had written in the agent's shape instead of the route's, which is
 * how a native SOL row without a mint reached production unseen.
 */
export const FIXTURE_HOLDINGS_ENV = "RYNTRA_AGENT_FIXTURE_HOLDINGS";

function holdingsThroughRoute(request: Request): HoldingsReader {
  return async (owner) => {
    /* The caller's own headers travel with the in-process call — so the holdings route's rate limiter keys the read to the same caller it would key a direct call to — less the credentials, which the read neither needs nor should see. Nothing here reads an address or a place. */
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    try {
      const response = await readHoldingsRoute(new Request(new URL("/api/solana/holdings", request.url), { method: "POST", headers, body: JSON.stringify({ owner, network: "mainnet" }) }));
      /* Read against the contract, never cast: the route's native SOL row has no mint. */
      return holdingsReadFromAnswer(response.status, await response.json());
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "the holdings route did not answer" };
    }
  };
}

const fixtureWorlds = globalThis as typeof globalThis & { __ryntraAgentFixtureWorlds?: Map<string, Promise<FixtureWorld>> };

async function fixtureWorldFor(owner: string): Promise<FixtureWorld> {
  fixtureWorlds.__ryntraAgentFixtureWorlds ??= new Map();
  const map = fixtureWorlds.__ryntraAgentFixtureWorlds;
  let world = map.get(owner);
  if (!world) {
    /* The fixture's plans are written at the fixture's own moment: their entry windows are dated, and a later clock would refuse them. */
    world = createFixtureWorld({ store: getGuardRuntime().store, owner, nowMs: FIXTURE_NOW_MS });
    map.set(owner, world);
  }
  return world;
}

/**
 * AI-09 `store` on the stand: the fixture world, but the news read from the
 * stand's own store, where the real collector wrote what the live feeds
 * published — so the eyes see today's headlines against the fixture market.
 */
export const FIXTURE_NEWS_ENV = "RYNTRA_AGENT_FIXTURE_NEWS";

function withStandNews(readers: FixtureWorld["readers"]): FixtureWorld["readers"] {
  if (process.env[FIXTURE_NEWS_ENV]?.trim() !== "store") return readers;
  return { ...readers, news: (mint) => readDigest(getGuardRuntime().store, mint, Date.now()) };
}

export function fixturesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[FIXTURES_ENV]?.trim() === "1";
}

/** The stand's model is the fixture: `modelEnabled` follows the deployment's switch so the budget path is walked, and nothing is spent. */
function fixtureDeps(world: FixtureWorld, readers: FixtureWorld["readers"]): AgentDeps {
  const budget = resolveAgentBudgetConfig(process.env);
  const on = budget.modelEnabled || process.env.RYNTRA_AGENT_FIXTURE_MODEL === "1";
  /* The stand's credits: the same ledger in the stand's store, every wallet its own holder (no accounts store there). */
  return { store: getGuardRuntime().store, readers, model: on ? createFixtureAgentModel({ invent: process.env.RYNTRA_AGENT_FIXTURE_INVENT === "1" }) : null, budget: { ...budget, modelEnabled: on }, credits: creditsDeps(null) };
}

/** AI-04: a wallet's account, from the accounts store — `undefined` when it did not answer, never a guess. */
const accountOfWallet = (wallet: string) => accountByWallet("solana", wallet);

/** AI-04: whose credits the proven wallet spends now, on this deployment's terms; `null` where credits are switched off. */
export async function creditsContextForWallet(owner: string, nowMs: number): Promise<CreditsContext | null> {
  return creditsContextFor({ store: getGuardRuntime().store, credits: creditsDeps(fixturesOn() ? null : accountOfWallet) }, owner, nowMs);
}

/** AI-04: the holder for the welcome credits — read past the minute's memory, and `known` false when the accounts store did not answer (no welcome then). */
export async function welcomeHolderForWallet(owner: string, nowMs: number): Promise<(ResolvedHolder & Readonly<{ config: CreditsContext["config"] }>) | null> {
  const deps = creditsDeps(null);
  if (!deps) return null;
  const resolved = await resolveHolder(getGuardRuntime().store, owner, fixturesOn() ? null : accountOfWallet, nowMs);
  return { ...resolved, config: deps.config };
}

/** The dependencies for the proven wallet: the real readers, or the wallet's fixture world on the stand. */
export async function agentDepsFor(request: Request, owner: string): Promise<AgentDeps> {
  const store = getGuardRuntime().store;
  if (fixturesOn()) {
    const world = await fixtureWorldFor(owner);
    return fixtureDeps(world, withStandNews(process.env[FIXTURE_HOLDINGS_ENV]?.trim() === "route" ? { ...world.readers, holdings: holdingsThroughRoute(request) } : world.readers));
  }
  return { ...createAgentDeps({ store, holdings: holdingsThroughRoute(request) }), credits: creditsDeps(accountOfWallet) };
}

/**
 * 1.43.0: the dependencies for a guest — the market's real readers (the
 * service wraps them so nothing of anyone's own answers), or the stand's
 * fixture market. No holdings route is ever called for a guest.
 */
export async function agentGuestDeps(): Promise<AgentDeps> {
  const store = getGuardRuntime().store;
  if (fixturesOn()) {
    const world = await fixtureWorldFor(FIXTURE_OWNER);
    return fixtureDeps(world, withStandNews(world.readers));
  }
  return createAgentDeps({ store, holdings: async () => ({ ok: false, reason: "a guest holds nothing here" }) });
}

/**
 * AI-10: the readers and the model of «Ранковий огляд» for one pass of its
 * cron — the real readers with the holdings route called in-process (the
 * cron's own request carries no person's headers), or, on the stand, the
 * fixture market with every wallet's own part read as the fixture wallet's,
 * so a throwaway wallet signed in on the stand sees a brief with changes.
 */
export async function briefDepsFor(request: Request): Promise<Readonly<{ readers: AgentDeps["readers"]; model: AgentDeps["model"]; budget: AgentDeps["budget"]; concurrency?: number }>> {
  if (fixturesOn()) {
    const world = await fixtureWorldFor(FIXTURE_OWNER);
    const deps = fixtureDeps(world, withStandNews(world.readers));
    const readers = deps.readers;
    /* The stand's store holds one connection: one person at a time. */
    return { readers: { ...readers, holdings: () => readers.holdings(FIXTURE_OWNER), watchlist: () => readers.watchlist(FIXTURE_OWNER) }, model: deps.model, budget: deps.budget, concurrency: 1 };
  }
  const store = getGuardRuntime().store;
  const deps = createAgentDeps({ store, holdings: holdingsThroughRoute(request) });
  /* The brief reads the watchlist so that a store that did not answer is a failure it can say — never an empty list it would read as «nothing changed». */
  const watchlist = async (owner: string): Promise<readonly string[]> => {
    const raw = await store.collection<unknown>("spotWatchlists").get(spotWatchlistKey(owner));
    if (raw === undefined || raw === null) return [];
    const parsed = SpotWatchlistSchema.safeParse(raw);
    if (!parsed.success) throw new Error("the watchlist could not be read");
    return parsed.data.mints;
  };
  return { readers: { ...deps.readers, watchlist }, model: deps.model, budget: deps.budget };
}
