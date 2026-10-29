import type { ChainLink } from "./contract";
import type { LinkVerdict } from "./api";

/**
 * Whether an engine object is the caller's, read from the engine itself and
 * never from the request. Only reads: nothing here writes, signs or moves
 * anything. Each engine part is loaded when it is first needed, so the world's
 * routes do not carry the whole engine.
 *
 * - a coin: launched through Ryntra Launch, and the wallet that signed the
 *   launch is the caller's proven wallet;
 * - a pool position: the chain says the caller's wallet may withdraw it;
 * - a strategy: Strategy Lab keeps it under the caller's account;
 * - a team: the caller's wallet is an active member;
 * - a paper prediction book: the caller's own account (checked before this);
 * - an agent: the engine keeps no owner for an agent yet, so no agent link
 *   can be proven and none is made.
 *
 * A read that does not answer is `unavailable`; it never turns into a yes.
 */

const READ_TIMEOUT_MS = 8_000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), READ_TIMEOUT_MS);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

async function coinCreator(mint: string, wallet: string): Promise<LinkVerdict> {
  const [{ launchNetwork }, { getGuardRuntime }, { launchKey }] = await Promise.all([
    import("../launch/config.server"),
    import("../guard/runtime"),
    import("../launch/record-key"),
  ]);
  const network = launchNetwork();
  if (!network) return "unverifiable";
  type Launch = { state: "PENDING" | "LAUNCHED"; creator: string };
  const record = await withTimeout(getGuardRuntime().store.collection<Launch>("launches").get(launchKey(network.cluster, mint)));
  if (!record) return "not_owned";
  if (record.state !== "LAUNCHED") return "unverifiable";
  return record.creator === wallet ? "owned" : "not_owned";
}

async function positionOwner(position: string, wallet: string): Promise<LinkVerdict> {
  const [{ liquidityVenues }, { poolsConnection }] = await Promise.all([
    import("../liquidity/studio/venues.server"),
    import("../liquidity/catalog/chain.server"),
  ]);
  const venues = liquidityVenues(poolsConnection());
  for (const venue of ["meteora-dlmm", "meteora-damm2"] as const) {
    const found = await withTimeout(venues[venue].position(position));
    if (!found) continue;
    if (!found.owner) return "unverifiable";
    return found.owner === wallet ? "owned" : "not_owned";
  }
  return "not_owned";
}

async function strategyOwner(strategyId: string, accountId: string | null): Promise<LinkVerdict> {
  if (!accountId) return "not_owned";
  const { strategyLabGet } = await import("../strategy-lab/rpc");
  const read = await strategyLabGet({
    subject: { accountId, telegramId: null }, strategyId,
    versionLimit: 1, versionsBeforeRecordedAt: null, versionsBeforeId: null,
    runLimit: 1, runsBeforeCreatedAt: null, runsBeforeId: null,
    proposalLimit: 1, proposalsBeforeCreatedAt: null, proposalsBeforeId: null,
  });
  if (!read.ok) return "unavailable";
  return read.data ? "owned" : "not_owned";
}

async function teamMember(teamId: string, wallet: string): Promise<LinkVerdict> {
  const [{ teamsServed }, { readTeam }] = await Promise.all([import("../team/runtime.server"), import("../team/service.server")]);
  const served = teamsServed();
  if (!served.served) return "unverifiable";
  const read = await withTimeout(readTeam(served.deps, teamId, wallet));
  if (read.ok) return read.team.you.status === "ACTIVE" ? "owned" : "not_owned";
  return read.code === "UNAVAILABLE" ? "unavailable" : "not_owned";
}

export async function verifyLinkOwnership(input: Readonly<{ link: ChainLink; accountId: string | null; wallet: string }>): Promise<LinkVerdict> {
  try {
    switch (input.link.kind) {
      case "mint":
        return await coinCreator(input.link.mint, input.wallet);
      case "lp_position":
        return await positionOwner(input.link.position, input.wallet);
      case "strategy":
        return await strategyOwner(input.link.strategyId, input.accountId);
      case "team":
        return await teamMember(input.link.teamId, input.wallet);
      case "prediction_book":
        return input.accountId !== null && input.link.accountId === input.accountId ? "owned" : "not_owned";
      case "agent":
        return "unverifiable";
    }
  } catch {
    return "unavailable";
  }
}
