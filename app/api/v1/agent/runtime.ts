import { POST as readHoldingsRoute } from "@/app/api/solana/holdings/route";
import { resolveAgentBudgetConfig } from "@/lib/agent/budget";
import { holdingsReadFromAnswer } from "@/lib/agent/holdings-from-route";
import { createFixtureWorld, type FixtureWorld } from "@/lib/agent/fixtures";
import { createFixtureAgentModel } from "@/lib/agent/model";
import { createAgentDeps, type HoldingsReader } from "@/lib/agent/runtime.server";
import type { AgentDeps } from "@/lib/agent/service";
import { getGuardRuntime } from "@/lib/guard/runtime";

/**
 * The agent's dependencies for one request (`RYN-AGENT-TEXT-001`).
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
 * how a native SOL row without a mint reached production unseen
 * (`RYN-API-CONTRACT-002`).
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
      /* Read against the contract, never cast: the route's native SOL row has no mint (`RYN-API-CONTRACT-002`). */
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
    world = createFixtureWorld({ store: getGuardRuntime().store, owner, nowMs: Date.now() });
    map.set(owner, world);
  }
  return world;
}

export function fixturesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[FIXTURES_ENV]?.trim() === "1";
}

/** The dependencies for the proven wallet: the real readers, or the wallet's fixture world on the stand. */
export async function agentDepsFor(request: Request, owner: string): Promise<AgentDeps> {
  const store = getGuardRuntime().store;
  if (fixturesOn()) {
    const world = await fixtureWorldFor(owner);
    const budget = resolveAgentBudgetConfig(process.env);
    /* The stand's model is the fixture: `modelEnabled` follows the Owner's switch so the budget path is walked, and nothing is spent. */
    const readers = process.env[FIXTURE_HOLDINGS_ENV]?.trim() === "route" ? { ...world.readers, holdings: holdingsThroughRoute(request) } : world.readers;
    return { store, readers, model: budget.modelEnabled || process.env.RYNTRA_AGENT_FIXTURE_MODEL === "1" ? createFixtureAgentModel({ invent: process.env.RYNTRA_AGENT_FIXTURE_INVENT === "1" }) : null, budget: { ...budget, modelEnabled: budget.modelEnabled || process.env.RYNTRA_AGENT_FIXTURE_MODEL === "1" } };
  }
  return createAgentDeps({ store, holdings: holdingsThroughRoute(request) });
}
